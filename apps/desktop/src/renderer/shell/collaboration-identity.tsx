import type { CSSProperties } from 'react';
import type { CollaborationMember } from '@sync-think/shared';
import { AgentWorkspaceAvatar as AgentAvatarView } from './AgentWorkspaceAvatar.js';
import './collaboration-chat.css';

/** Group name from its members, e.g. "研究员 + 审查员 + 设计师 等 5 位". */
export function collaborationGroupTitle(names: readonly string[]) {
  const shown = names.slice(0, 3).join(' + ');
  return names.length > 3 ? `${shown} 等 ${names.length} 位` : shown || '智能体群聊';
}

/** Overlapping faces; `arriving` staggers them in when the group first comes alive. */
export function AvatarCluster({ members, size, max = 4, arriving, animate = false }: { members: readonly Pick<CollaborationMember, 'id' | 'name' | 'avatar'>[]; size: number; max?: number; arriving?: boolean; animate?: boolean }) {
  const shown = members.slice(0, max);
  return <span style={{ '--cluster-size': `${size}px` } as CSSProperties} className={`collab-cluster${shown.length === 3 ? ' is-triangle' : ''}${arriving ? ' is-arriving' : ''}`} aria-hidden="true">
    {shown.map((member, index) => <span className="collab-cluster__face" data-avatar-id={member.id} key={member.id} style={{ zIndex: shown.length - index, animationDelay: `${index * 70}ms` }}><AgentAvatarView name={member.name} avatar={member.avatar} size={size} animate={animate} /></span>)}
    {members.length > max && <span className="collab-cluster__more" style={{ width: size, height: size }}>+{members.length - max}</span>}
  </span>;
}
