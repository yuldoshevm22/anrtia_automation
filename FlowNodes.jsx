import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap, Bell, CheckSquare, ArrowRightLeft, Globe, Clock, Sparkles, Brain, Code, RadioReceiver, Send, Mail, MessageCircle, Repeat } from 'lucide-react';

const ICONS = {
  trigger: Zap,
  send_notification: Bell,
  create_task: CheckSquare,
  change_stage: ArrowRightLeft,
  webhook: Globe,
  http_request: Globe,
  wait: Clock,
  wait_webhook: RadioReceiver,
  ai_generate: Sparkles,
  ai_decision: Brain,
  update_field: Code,
  send_telegram: Send,
  send_whatsapp: MessageCircle,
  send_instagram: Send,
  send_facebook: MessageCircle,
  send_email: Mail,
  loop: Repeat,
};

export function ActionNode({ data }) {
  const Icon = ICONS[data.actionType] || Zap;
  const isAi = data.actionType?.startsWith('ai_');

  return (
    <div style={{
      background: 'var(--surface-solid)',
      border: `2px solid ${isAi ? '#6c5ce7' : 'var(--glass-border)'}`,
      borderRadius: 16,
      padding: 16,
      minWidth: 220,
      boxShadow: isAi ? '0 0 20px rgba(108,92,231,0.2)' : '0 4px 6px rgba(0,0,0,0.05)'
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--primary)', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          padding: 8,
          borderRadius: 10,
          background: isAi ? 'rgba(108,92,231,0.15)' : 'var(--primary-glow)',
          color: isAi ? '#6c5ce7' : 'var(--primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Icon size={18} />
        </div>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem' }}>{data.label}</span>
      </div>
      {data.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{data.description}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--success)', width: 8, height: 8 }} />
    </div>
  );
}

export function ConditionNode({ data }) {
  return (
    <div style={{
      background: 'var(--surface-solid)',
      border: '2px solid var(--warning)',
      borderRadius: 16,
      padding: '16px 24px',
      minWidth: 200,
      boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--primary)', width: 8, height: 8 }} />
      <div style={{ fontWeight: 700, color: 'var(--warning)', fontSize: '0.9rem', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Zap size={16} /> {data.label || 'Условие'}
      </div>
      {data.condition && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>{data.condition}</div>}
      
      <div style={{ position: 'absolute', bottom: -12, left: '20%', background: 'var(--surface-solid)', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', color: 'var(--success)', border: '1px solid var(--glass-border)', zIndex: 10 }}>Да</div>
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: '30%', background: 'var(--success)', width: 8, height: 8 }} />
      
      <div style={{ position: 'absolute', bottom: -12, right: '20%', background: 'var(--surface-solid)', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', color: 'var(--danger)', border: '1px solid var(--glass-border)', zIndex: 10 }}>Нет</div>
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: '70%', background: 'var(--danger)', width: 8, height: 8 }} />
    </div>
  );
}

export function TriggerNode({ data }) {
  const Icon = ICONS.trigger;
  return (
    <div style={{
      background: 'var(--surface-solid)',
      border: '2px solid var(--success)',
      borderRadius: 16,
      padding: 16,
      minWidth: 220,
      boxShadow: '0 0 20px rgba(0,212,170,0.2)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          padding: 8,
          borderRadius: 10,
          background: 'rgba(0,212,170,0.15)',
          color: 'var(--success)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Icon size={18} />
        </div>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem' }}>{data.label || 'Триггер'}</span>
      </div>
      {data.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{data.description}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--success)', width: 8, height: 8 }} />
    </div>
  );
}

export const nodeTypes = {
  action: ActionNode,
  condition: ConditionNode,
  trigger: TriggerNode
};
