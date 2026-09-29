import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { isImageFile, readFileAsDataUrl, type ComposeAttachment } from './compose-mention.js';
import { compressImageDataUrl } from './image-compress.js';

type Job = {
  file: File;
  attachment: ComposeAttachment;
  controller: AbortController;
  objectUrl?: string;
};
type Options = {
  attachments: readonly ComposeAttachment[];
  setAttachments: Dispatch<SetStateAction<ComposeAttachment[]>>;
  scopeKey: string;
  onError: (file: File) => void;
};

/** Local preparation, not a fake network upload. Pending images never enter outbound drafts. */
export function useComposerImageUploads(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const jobs = useRef(new Map<string, Job>());
  // Cover the short interval between scheduling a ready image and React committing it.
  const awaitingCommit = useRef(new Set<string>());
  for (const attachment of options.attachments) awaitingCommit.current.delete(attachment.path);
  const running = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState<ComposeAttachment[]>([]);
  const publish = useCallback(() => {
    if (mounted.current) setPending([...jobs.current.values()].map((job) => job.attachment));
  }, []);
  const release = useCallback((path: string) => {
    const job = jobs.current.get(path);
    if (!job) return;
    jobs.current.delete(path);
    job.controller.abort();
    if (job.objectUrl) URL.revokeObjectURL(job.objectUrl);
  }, []);

  useLayoutEffect(() => {
    const activeJobs = jobs.current;
    const reservations = awaitingCommit.current;
    mounted.current = true;
    setPending([]);
    return () => {
      mounted.current = false;
      [...activeJobs.keys()].forEach(release);
      reservations.clear();
    };
  }, [options.scopeKey, release]);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (mounted.current && jobs.current.size) {
        const [path, job] = jobs.current.entries().next().value as [string, Job];
        const current = () =>
          mounted.current && jobs.current.get(path) === job && !job.controller.signal.aborted;
        const progress = (value: number, label: string, previewUrl?: string) => {
          if (!current()) return;
          job.attachment = {
            ...job.attachment,
            progress: value,
            processingLabel: label,
            ...(previewUrl ? { previewUrl } : {}),
          };
          publish();
        };
        try {
          progress(0, '正在读取图片');
          const raw = await readFileAsDataUrl(job.file, {
            signal: job.controller.signal,
            onProgress: (fraction) => progress(Math.round(fraction * 80), '正在读取图片'),
          });
          if (!current()) continue;
          // 80–100 is the compression stage, not an invented byte-transfer percentage.
          progress(80, '正在优化图片', raw);
          const compressed = await compressImageDataUrl(raw, {
            mimeType: job.file.type || 'image/png',
          });
          if (!current()) continue;
          const ready: ComposeAttachment = {
            path,
            name: job.attachment.name,
            kind: 'image',
            previewUrl: compressed.dataUrl,
            mimeType: compressed.mimeType,
            sizeBytes: Math.floor(
              (compressed.dataUrl.length - compressed.dataUrl.indexOf(',') - 1) * 0.75,
            ),
          };
          const scope = latest.current.scopeKey;
          awaitingCommit.current.add(path);
          latest.current.setAttachments((attachments) =>
            scope !== latest.current.scopeKey || attachments.some((item) => item.path === path)
              ? attachments
              : [...attachments, ready],
          );
          release(path);
          publish();
        } catch {
          if (!current()) continue;
          release(path);
          publish();
          latest.current.onError(job.file);
        }
      }
    } finally {
      running.current = false;
    }
  }, [publish, release]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const available = Math.max(
        0,
        8 -
          latest.current.attachments.filter((item) => item.kind === 'image').length -
          jobs.current.size -
          awaitingCommit.current.size,
      );
      for (const file of Array.from(files).filter(isImageFile).slice(0, available)) {
        const path = `image:${crypto.randomUUID()}`;
        const objectUrl =
          typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
        jobs.current.set(path, {
          file,
          controller: new AbortController(),
          objectUrl,
          attachment: {
            path,
            name: file.name || 'image',
            kind: 'image',
            previewUrl: objectUrl,
            mimeType: file.type,
            progress: 0,
            processingLabel: '等待处理',
          },
        });
      }
      publish();
      return pump();
    },
    [publish, pump],
  );

  const remove = useCallback(
    (path: string) => {
      awaitingCommit.current.delete(path);
      release(path);
      publish();
      latest.current.setAttachments((attachments) =>
        attachments.filter((item) => item.path !== path),
      );
    },
    [publish, release],
  );
  const isBusy = useCallback(() => jobs.current.size > 0, []);
  const items = useMemo(() => [...options.attachments, ...pending], [options.attachments, pending]);
  return { items, addFiles, remove, isBusy, pending: pending.length > 0 };
}
