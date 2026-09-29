import { useEffect, useState } from 'react';
import { FolderOpen, Save } from 'lucide-react';
const DIRECTORY_KEY = 'data.projectless.directory';

export function ProjectlessDataSetting() {
  const [directory, setDirectory] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const api = window.syncThink?.runtime;
    if (!api?.getSettings) {
      setLoading(false);
      setError('数据设置服务尚未就绪');
      return;
    }
    void api
      .getSettings({ keys: [DIRECTORY_KEY] })
      .then((result) => {
        if (!active) return;
        const value = result.settings[DIRECTORY_KEY];
        if (typeof value === 'string') {
          setDirectory(value);
          setSaved(value);
        }
      })
      .catch((err) => {
        if (active) setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function chooseDirectory() {
    try {
      const result = await window.syncThink?.runtime?.pickFolder({
        title: '选择未绑定工作区的数据目录',
      });
      if (result?.path && !result.canceled) {
        setDirectory(result.path);
        setNotice('');
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function saveDirectory() {
    const api = window.syncThink?.runtime;
    if (!api) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.setSetting({ key: DIRECTORY_KEY, value: directory.trim() });
      const result = await api.getSettings({ keys: [DIRECTORY_KEY] });
      const value = String(result.settings[DIRECTORY_KEY] ?? directory.trim());
      setDirectory(value);
      setSaved(value);
      setNotice('已保存，新对话将使用此目录');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-data-card" aria-labelledby="projectless-data-title">
      <h2 className="settings-data-card__title" id="projectless-data-title">
        未绑定工作区的数据
      </h2>
      <div className="settings-data-card__body settings-data-stack">
        <div className="settings-data-copy">
          <strong>对话与全局任务目录</strong>
          <p>
            每个对话独立存放生成的文件与消息副本，适用于日常对话和未绑定工作区的定时任务。应用数据库继续保存对话索引与记录。
          </p>
        </div>
        <label className="projectless-data-path">
          <span>存放路径</span>
          <input
            aria-label="未绑定工作区的数据目录"
            value={directory}
            disabled={loading || busy}
            onChange={(event) => {
              setDirectory(event.target.value);
              setNotice('');
            }}
            placeholder={loading ? '读取中…' : '输入绝对路径'}
            spellCheck={false}
          />
        </label>
        <div className="projectless-data-actions">
          <button
            type="button"
            className="settings-data-button settings-data-button--secondary"
            disabled={loading || busy}
            onClick={() => void chooseDirectory()}
          >
            <FolderOpen size={14} />
            选择文件夹
          </button>
          <button
            type="button"
            className="settings-data-button"
            disabled={loading || busy || !directory.trim() || directory.trim() === saved}
            onClick={() => void saveDirectory()}
          >
            <Save size={14} />
            {busy ? '保存中…' : '保存路径'}
          </button>
        </div>
        <p className="projectless-data-hint">
          修改后对新对话生效；已有对话保留原目录，文件不会被移动。
        </p>
        {notice ? (
          <p role="status" className="projectless-data-success">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="projectless-data-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
