import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Flag, Clock, Send, FileText, Paperclip, Pencil, Download, Trash2, Upload, ChevronLeft } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPerm } from '../../lib/roles.js';
import { useNotifications } from '../../context/NotificationsContext.jsx';
import { Money, initials } from './bits.jsx';
import DynamicForm from './DynamicForm.jsx';
import AssigneePicker from './AssigneePicker.jsx';

/* ═══════════════════════════════════════════════════════════════════════════
   «Модалка заявки — Вариант A (fullscreen, проработанный)».
   Контракт с API/движком процесса ПОЛНОСТЬЮ сохранён (1:1 со старым CardModalV2):
   те же useQuery/useMutation, те же ключи queryKey, те же эндпоинты и права.
   Изменена ТОЛЬКО вёрстка: командная шапка (без синей полосы-акцента, с суммой и
   первичными действиями), блок-карточка этапа в центре «Процесса», скруглённые
   кнопки. Вкладки, «Данные» (две колонки), «Документы», «Чат», «История» — как в системе.
   ═══════════════════════════════════════════════════════════════════════════ */

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const hm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const num = (i) => String(i + 1).padStart(2, '0');
const HIDE_IN_VIEW = new Set(['amount', 'currency']);
const FLABEL = { contractor: 'Контрагент', company: 'Компания', amount: 'Сумма', due_date: 'Дата', title: 'Название', accountant: 'Бухгалтер', terms: 'Условие оплаты', requisites: 'Реквизиты', dept: 'Департамент', subdiv: 'Подразделение', role: 'Роль', ctype: 'Тип компании', tpl: 'Шаблон договора', prolong: 'Автопролонгация', signed: 'Подписан' };
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v); if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((t - dd) / 86400000);
  if (diff <= 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.0', '') + ' МБ' : b >= 1024 ? Math.round(b / 1024) + ' КБ' : (b || 0) + ' Б';
const EXTMAP = { pdf: 'pdf', doc: 'doc', docx: 'doc', xls: 'xls', xlsx: 'xls', csv: 'xls', jpg: 'img', jpeg: 'img', png: 'img' };
const extOf = (n) => { const e = (String(n).split('.').pop() || '').toLowerCase(); return { cls: EXTMAP[e] || '', label: (e || 'файл').slice(0, 4).toUpperCase() }; };
// цветные аватары по инициалам — чистый UI-хелпер (в API не выносим)
const AV_HUES = [210, 152, 26, 280, 340, 42, 190, 120];
function avStyle(seed) {
  const s = String(seed || ''); if (!s) return undefined;
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = AV_HUES[h % AV_HUES.length];
  return { background: `linear-gradient(135deg, oklch(0.82 0.09 ${hue}), oklch(0.9 0.05 ${hue}))`, color: `oklch(0.42 0.13 ${hue})`, borderColor: 'transparent' };
}

export default function CardModalV2({ id, stages, cfg, onClose, onOpenEntity }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { notify } = useNotifications();
  const [tab, setTab] = useState('process');
  const [sel, setSel] = useState(null);           // выбранный этап в рельсе (null → следует за текущим)
  const [decision, setDecision] = useState('');
  const [reqMiss, setReqMiss] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const fileRef = useRef(null);

  const { data: req } = useQuery({ queryKey: ['request', id], queryFn: async () => (await api.get(`/requests/${id}`)).data.request });
  const { data: history = [] } = useQuery({ queryKey: ['history', id], queryFn: async () => (await api.get(`/requests/${id}/history`)).data.history });
  const { data: messages = [] } = useQuery({ queryKey: ['messages', id], queryFn: async () => (await api.get(`/requests/${id}/messages`)).data.messages });
  const { data: documents = [] } = useQuery({ queryKey: ['documents', id], queryFn: async () => (await api.get(`/requests/${id}/documents`)).data.documents });
  const isFinal = !!req?.is_final;
  const { data: closing } = useQuery({ queryKey: ['closing', id], enabled: isFinal, queryFn: async () => (await api.get(`/requests/${id}/closing`)).data });

  const transition = useMutation({
    mutationFn: ({ action, comment }) => api.post(`/requests/${id}/transition`, { action, ...(comment ? { comment } : {}) }),
    onSuccess: () => {
      setDecision(''); setReqMiss(null); setSel(null);
      qc.invalidateQueries({ queryKey: ['board', cfg.process] });
      qc.invalidateQueries({ queryKey: ['request', id] });
      qc.invalidateQueries({ queryKey: ['history', id] });
      qc.invalidateQueries({ queryKey: ['messages', id] });
      qc.invalidateQueries({ queryKey: ['closing', id] });
    },
    onError: (e) => {
      const d = e?.response?.data;
      if (e?.response?.status === 422 && d?.error === 'requirements_unmet') { setReqMiss(d.missing || {}); setTab('process'); setSel(null); return; }
      const MSG = { forbidden: 'Недостаточно прав для этого действия', no_transition: 'Переход недоступен на текущей стадии', unknown_action: 'Действие недоступно на этой стадии', auto_chain_overflow: 'Ошибка процесса: проверьте авто-переходы', not_found: 'Заявка не найдена или была изменена' };
      notify(MSG[d?.error] || 'Не удалось выполнить действие. Попробуйте ещё раз.', 'warn');
    },
  });
  const assignMut = useMutation({
    mutationFn: (userId) => api.patch(`/requests/${id}/assignee`, { userId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['request', id] }); qc.invalidateQueries({ queryKey: ['board', cfg.process] }); qc.invalidateQueries({ queryKey: ['history', id] }); },
    onError: () => notify('Не удалось сменить ответственного', 'warn'),
  });
  const saveEdit = useMutation({
    mutationFn: (values) => api.patch(`/requests/${id}`, { values }),
    onSuccess: () => { setEditing(false); setFieldErrors({}); qc.invalidateQueries({ queryKey: ['request', id] }); qc.invalidateQueries({ queryKey: ['board', cfg.process] }); qc.invalidateQueries({ queryKey: ['history', id] }); },
    onError: (e) => {
      const d = e?.response?.data;
      if (e?.response?.status === 422 && d?.fields) setFieldErrors(d.fields);
      else if (e?.response?.status === 403 && d?.field) setFieldErrors({ [d.field]: 'нет прав на изменение' });
    },
  });
  const sendMsg = useMutation({
    mutationFn: (body) => api.post(`/requests/${id}/messages`, { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', id] }); qc.invalidateQueries({ queryKey: ['history', id] }); },
  });
  const uploadDocs = useMutation({
    mutationFn: (files) => { const fd = new FormData(); [...files].forEach((f) => fd.append('files', f)); fd.append('kind', 'doc'); return api.post(`/requests/${id}/documents`, fd); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents', id] }); qc.invalidateQueries({ queryKey: ['messages', id] }); qc.invalidateQueries({ queryKey: ['history', id] }); },
    onError: () => notify('Не удалось загрузить файл', 'warn'),
  });
  const delDoc = useMutation({
    mutationFn: (docId) => api.delete(`/documents/${docId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents', id] }); qc.invalidateQueries({ queryKey: ['history', id] }); },
  });
  const closeMut = useMutation({
    mutationFn: ({ name, got }) => api.post(`/requests/${id}/closing`, { name, got }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['closing', id] }); qc.invalidateQueries({ queryKey: ['request', id] }); qc.invalidateQueries({ queryKey: ['history', id] }); qc.invalidateQueries({ queryKey: ['board', cfg.process] }); },
  });

  async function download(doc) {
    try {
      const r = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click(); URL.revokeObjectURL(url);
    } catch (_) { notify('Не удалось скачать документ', 'warn'); }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!req) {
    return (
      <div className="cmv2-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="cmv2"><div className="mloading">Загрузка…</div></div>
      </div>
    );
  }

  const curPos = req.stage_pos || 0;
  const total = stages.length || 1;
  const closingDone = isFinal && closing?.done;
  const finished = closingDone;
  const selIdx = sel == null ? curPos : Math.min(sel, total - 1);
  const stateOf = (i) => i < curPos ? 'done' : i === curPos ? 'cur' : 'wait';

  const statusClass = finished ? ' st-done' : req.correcting ? ' st-corr' : '';
  const doneCount = curPos + (finished ? 1 : 0);
  const pct = Math.round(doneCount / total * 100);

  // права/действия — из available_actions, отфильтровано по act.<process>.<suffix> (сервер тоже гейтит)
  const ACT_PERM_SUFFIX = { approve: 'approve', reject: 'reject', correction: 'correct' };
  const allowedActions = (req.available_actions || []).filter((a) => { const suf = ACT_PERM_SUFFIX[a.kind]; return !suf || hasPerm(user, 'act.' + cfg.process + '.' + suf); });
  const requiresOf = (action) => ((req.available_actions || []).find((a) => a.action_key === action)?.requires) || {};
  function doAction(action) {
    const rq = requiresOf(action);
    if (rq.comment && !decision.trim()) { setReqMiss({ comment: true }); return; }
    setReqMiss(null);
    transition.mutate({ action, comment: decision.trim() || undefined });
  }
  // Первичные действия для командной шапки: если у действия есть требования
  // (комментарий/поля/документы) — уводим на вкладку «Процесс» к полному гейту,
  // иначе выполняем сразу. Никакой отдельной логики на сервере не появляется.
  function headAction(a) {
    const rq = requiresOf(a.action_key);
    if (rq.comment || rq.fields?.length || rq.docs?.length) { setTab('process'); setSel(null); return; }
    setReqMiss(null);
    transition.mutate({ action: a.action_key });
  }
  const canChange = hasPerm(user, 'act.' + cfg.process + '.create');
  const roleFallback = cfg.roleFallback || 'Ответственный';

  // поля карточки (view/edit)
  const schemaFields = req.fields_schema || [];
  const fieldDisplay = req.field_display || {};
  const viewFields = schemaFields.filter((f) => !HIDE_IN_VIEW.has(f.key));
  const canEditAny = schemaFields.some((f) => !f.visibility || f.visibility.can_edit !== false);
  const dispVal = (f) => { const v = fieldDisplay[f.key]; if (v == null || v === '') return '—'; return f.data_type === 'date' ? fmtDate(v) : String(v); };
  function startEdit() { setDraft({ ...(req.field_values || {}) }); setFieldErrors({}); setEditing(true); }
  function cancelEdit() { setEditing(false); setFieldErrors({}); }
  function onDraft(k, v) { setDraft((s) => ({ ...s, [k]: v })); setFieldErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; }); }
  function commitEdit() {
    const base = req.field_values || {}; const changed = {};
    for (const k of Object.keys(draft)) if (String(draft[k] ?? '') !== String(base[k] ?? '')) changed[k] = draft[k];
    if (!Object.keys(changed).length) { setEditing(false); return; }
    saveEdit.mutate(changed);
  }

  // объединённая хронология (аудит + сообщения)
  const events = [
    ...history.map((h) => ({ kind: 'audit', t: h.created_at, data: h })),
    ...messages.map((m) => ({ kind: 'msg', t: m.created_at, data: m })),
  ].sort((a, b) => new Date(b.t) - new Date(a.t));

  const subParts = (cfg.subParts ? cfg.subParts(req) : [req.contr, req.company]).filter(Boolean);
  const headBadge = finished
    ? <span className="badge done"><Check className="lucide" /> Завершена</span>
    : req.correcting
      ? <span className="badge corr"><Flag className="lucide" /> На корректировке</span>
      : req.sla?.t
        ? <span className={'badge due'}><Clock className="lucide" /> SLA {req.sla.t}</span>
        : <span className="badge wait">Этап {num(curPos)}</span>;
  // первичные действия шапки (только approve/reject; корректировка живёт в панели этапа)
  const headActions = (finished || req.correcting) ? [] : allowedActions.filter((a) => a.kind === 'approve' || a.kind === 'reject');

  const openData = () => setTab('data');
  const assign = (u) => assignMut.mutate(u.id);
  const fieldEntity = (f) => (f.ref_entity === 'contractor' || f.key === 'contractor') ? ['contractors', req.contractor_id]
    : (f.ref_entity === 'company' || f.key === 'company') ? ['companies', req.company_id] : [null, null];

  return (
    <div className="cmv2-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'cmv2 v-a' + statusClass}>
        {/* ── командная шапка ── */}
        <div className="hd">
          <button className="back" title="Назад к реестру" onClick={onClose}><ChevronLeft className="lucide" /></button>
          <div className="htxt">
            <div className="htop"><span className="type">{req.type}</span><span className="code">{req.code}</span></div>
            <h1 title={req.title}>{req.title}</h1>
            {subParts.length > 0 && (
              <div className="sub">{subParts.map((p, i) => <span key={i} style={{ display: 'contents' }}>{i > 0 && <i />}<span>{p}</span></span>)}</div>
            )}
          </div>
          <div className="hmeta">
            <div className="stat"><span className="k">{cfg.amountLabel}</span><span className="amt"><Money amt={req.amt} cur={req.cur} /></span></div>
          </div>
          <div className="hact">
            {headBadge}
            {headActions.map((a) => {
              const cls = a.kind === 'approve' ? 'act ok' : 'act bad';
              const Icon = a.kind === 'approve' ? Check : Flag;
              return <button key={a.action_key} className={cls} disabled={transition.isPending} onClick={() => headAction(a)}><Icon className="lucide" /> {a.label || a.action_key}</button>;
            })}
            <button className="gbtn ic" title="Закрыть" onClick={onClose}><X className="lucide" /></button>
          </div>
        </div>

        <div className="tabs">
          <button className={tab === 'process' ? 'on' : ''} onClick={() => setTab('process')}>Процесс</button>
          <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Данные</button>
          <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>Документы <span className="tg g">{documents.length}</span></button>
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Чат {messages.length ? <span className="tg">{messages.length}</span> : null}</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>История</button>
        </div>

        {tab === 'process' && (
          <div className="view v1body">
            <aside className="psb">
              <div className="cap">Процесс согласования</div>
              <div className="prog2">
                <div className="t"><b>Пройдено {doneCount} из {total}</b><span>{pct}%</span></div>
                <div className="segs">{stages.map((s, i) => {
                  const cls = i < curPos || (i === curPos && finished) ? 'f' : i === curPos ? 'c' : '';
                  return <i key={s.id} className={cls} />;
                })}</div>
              </div>
              <div className="rail">
                {stages.map((s, i) => {
                  const st = stateOf(i);
                  const sub = st === 'done' ? 'Пройдено'
                    : st === 'wait' ? 'Ожидается'
                    : isFinal ? (closing ? (closing.done ? 'Документы собраны' : `${closing.got}/${closing.all} документов`) : 'Финальный этап')
                    : req.correcting ? 'На корректировке'
                    : `Ожидает решения · SLA ${req.sla?.t || '—'}`;
                  return (
                    <button key={s.id} className={'st-i ' + st + (i === selIdx ? ' sel' : '')} onClick={() => setSel(i)}>
                      <span className="dot">{st === 'done' ? <Check className="lucide" /> : st === 'cur' ? <i /> : num(i)}</span>
                      <span className="bd"><div className="nm">{s.name}</div><div className="st">{sub}</div></span>
                    </button>
                  );
                })}
              </div>
            </aside>
            <div className="pmain proc-card">
              <StageCard
                idx={selIdx} state={stateOf(selIdx)} stages={stages} req={req} cfg={cfg} isFinal={isFinal} closing={closing}
                canChange={canChange} roleFallback={roleFallback} onAssign={assign} onOpenData={openData}
                allowedActions={allowedActions} decision={decision} setDecision={setDecision} reqMiss={reqMiss}
                onAction={doAction} pending={transition.isPending} onToggleClosing={(name, got) => closeMut.mutate({ name, got })} />
            </div>
          </div>
        )}

        {tab === 'data' && (
          <div className="view data-body">
            <div className="d-left">
              <div className="sec" style={{ marginTop: 2 }}>{cfg.leftLabel || 'Данные заявки'}
                {!editing
                  ? (canEditAny && <button className="edit-btn" onClick={startEdit}><Pencil className="lucide" /> Редактировать</button>)
                  : (<span className="edit-actions"><button className="edit-save" disabled={saveEdit.isPending} onClick={commitEdit}><Check className="lucide" /> Сохранить</button><button className="edit-cancel" onClick={cancelEdit}>Отмена</button></span>)}
              </div>
              <WhoBlock req={req} canChange={canChange} onPick={assign} roleFallback={roleFallback} />
              {editing ? (
                <div className="form-wrap"><DynamicForm fields={schemaFields} types={req.types || []} values={draft} errors={fieldErrors} onChange={onDraft} /></div>
              ) : (
                <>
                  <div style={{ height: 6 }} />
                  {viewFields.map((f) => {
                    const [kind, eid] = fieldEntity(f);
                    const click = (kind && eid && onOpenEntity) ? () => onOpenEntity(kind, eid) : undefined;
                    return (
                      <div className="fld" key={f.key}>
                        <div className="k">{f.label}</div>
                        <div className={'v' + (click ? ' link' : '')} onClick={click} role={click ? 'button' : undefined} tabIndex={click ? 0 : undefined}>{dispVal(f)}</div>
                      </div>
                    );
                  })}
                  <div className="amtblock">
                    <div className="k">{cfg.amountLabel}</div>
                    <div className="amt">{cfg.card === 'zakupka' && req.amt === 0 ? <span style={{ color: 'var(--ink4)', fontSize: 18 }}>не указана</span> : <Money amt={req.amt} cur={req.cur} />}</div>
                    <div className={'sla ' + (req.sla?.s || '')}>{req.sla?.s === 'done' ? <Check className="lucide" /> : <Clock className="lucide" />} SLA · {req.sla?.t}</div>
                  </div>
                  {cfg.reqLines && (
                    <>
                      <div className="sec">{cfg.reqLabel}</div>
                      <div className="reqbox">{cfg.reqLines(req).map((line, i) => (
                        <div key={i}>{line.map((tok, j) => tok.b ? <b key={j}>{tok.t}</b> : tok.dim ? <span key={j} className="dim">{tok.t}</span> : <span key={j}>{tok.t}</span>)}</div>
                      ))}</div>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="d-right">
              <Composer onSend={(t) => sendMsg.mutate(t)} onAttach={() => { fileRef.current?.click(); }} pending={sendMsg.isPending} />
              <Feed events={events} />
            </div>
          </div>
        )}

        {tab === 'docs' && (
          <div className="view docs-room">
            <div className="docs-inner">
              <DropZone onFiles={(f) => uploadDocs.mutate(f)} pending={uploadDocs.isPending} />
              {documents.length === 0 && <div className="docs-empty">Документов пока нет.</div>}
              {documents.map((d) => {
                const e = extOf(d.name);
                return (
                  <div className="doc-row" key={d.id}>
                    <span className={'doc-ext ' + e.cls}>{e.label}</span>
                    <div className="doc-meta">
                      <div className="doc-name" title={d.name}>{d.name}</div>
                      <div className="doc-sub">{fmtSize(d.size)} · <b>{d.uploaded_name}</b> · {hm(d.created_at)}{d.kind?.startsWith('tpl:') ? ' · ' + d.kind.slice(4) : ''}</div>
                    </div>
                    <button className="doc-ic" title="Скачать" onClick={() => download(d)}><Download className="lucide" /></button>
                    {canChange && <button className="doc-ic del" title="Удалить" onClick={() => delDoc.mutate(d.id)}><Trash2 className="lucide" /></button>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'chat' && (
          <Chat messages={messages} me={user} onSend={(t) => sendMsg.mutate(t)} onAttach={() => fileRef.current?.click()} />
        )}

        {tab === 'history' && (
          <div className="view hist-room"><div className="hist-inner"><Feed events={events} /></div></div>
        )}

        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files.length) uploadDocs.mutate(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}

/* ── блок-карточка выбранного этапа (центр «Процесса») ── */
function StageCard({ idx, state, stages, req, cfg, isFinal, closing, canChange, roleFallback, onAssign, onOpenData, allowedActions, decision, setDecision, reqMiss, onAction, pending, onToggleClosing }) {
  const s = stages[idx] || {};
  const kick = `Этап ${num(idx)} из ${String(stages.length).padStart(2, '0')} · ${state === 'done' ? 'Пройден' : state === 'wait' ? 'Не начат' : isFinal ? 'Финальный' : 'Текущий'}`;
  const desc = state === 'done' ? 'Этап процесса пройден.'
    : state === 'wait' ? `Станет доступен после этапа «${stages[idx - 1]?.name || '—'}».`
    : isFinal ? 'Контроль получения закрывающих документов.'
    : req.correcting ? 'Заявка возвращена на корректировку — исправьте данные и отправьте повторно.'
    : `Примите решение по заявке на этом этапе${req.sla?.t ? ` · SLA ${req.sla.t}` : ''}.`;

  const badge = state === 'done' ? <span className="badge done"><Check className="lucide" /> Пройдено</span>
    : state === 'wait' ? <span className="badge wait">Ожидается</span>
    : isFinal ? (closing?.done ? <span className="badge done"><Check className="lucide" /> Завершена</span> : <span className="badge due"><Clock className="lucide" /> Ожидание · {closing ? `${closing.got}/${closing.all}` : '0/0'}</span>)
    : <span className="badge due"><Clock className="lucide" /> Ожидает решения</span>;

  const subject = (
    <>
      <div className="pc-sec"><span>Предмет согласования</span><button className="pc-link" onClick={onOpenData}>все данные →</button></div>
      <div className="kv">
        <div className="fld"><div className="k">{cfg.amountLabel}</div><div className="v"><Money amt={req.amt} cur={req.cur} /></div></div>
        {(cfg.detailFields ? cfg.detailFields(req) : []).slice(0, 3).map(([k, v], i) => (
          <div className="fld" key={i}><div className="k">{k}</div><div className="v">{v || '—'}</div></div>
        ))}
      </div>
    </>
  );

  let body;
  if (isFinal && state === 'cur') {
    body = (
      <>
        {closing?.done && <div className="banner done"><span className="bi"><Check className="lucide" /></span><div><b>Все закрывающие документы получены</b><span className="s">Заявка завершена</span></div></div>}
        <div className="pc-sec">Ответственный за этап</div>
        <WhoBlockInner req={req} canChange={canChange} onPick={onAssign} roleFallback={roleFallback} />
        <div className="pc-sec">Закрывающие документы</div>
        {(closing?.items || []).length === 0 && <div className="feed-empty">Для этого типа закрывающие документы не заданы.</div>}
        {(closing?.items || []).map((d, j) => (
          <div className={'cl-doc' + (d.got ? ' got' : '')} key={j}>
            <span className="chk">{d.got ? <Check className="lucide" /> : null}</span>
            <span className="nm">{d.name}</span>
            <span className="stt">{d.got ? 'Получен' : 'Ожидается'}</span>
            {canChange && (d.got
              ? <button className="cl-mk" onClick={() => onToggleClosing(d.name, false)}>Снять</button>
              : <button className="cl-mk" onClick={() => onToggleClosing(d.name, true)}>Отметить полученным</button>)}
          </div>
        ))}
      </>
    );
  } else if (state === 'cur') {
    body = (
      <>
        {req.correcting && <div className="banner corr"><span className="bi"><Flag className="lucide" /></span><div><b>Возвращена на корректировку</b><span className="s">Исправьте данные и отправьте повторно — заявка вернётся на стадию рассмотрения</span></div></div>}
        <div className="pc-sec">Ответственный за этап</div>
        <WhoBlockInner req={req} canChange={canChange} onPick={onAssign} roleFallback={roleFallback} />
        {subject}
        <div className="pc-sec">Решение по этапу</div>
        <textarea className={'cmt-in' + (reqMiss?.comment ? ' err' : '')} value={decision} placeholder="Комментарий к решению (попадёт в историю)…" onChange={(e) => setDecision(e.target.value)} />
        {reqMiss && (
          <div className="cmt-err">
            Нельзя продолжить:
            {reqMiss.fields?.length ? ` заполните поля — ${reqMiss.fields.map((f) => FLABEL[f] || f).join(', ')};` : ''}
            {reqMiss.docs?.length ? ` приложите документы — ${reqMiss.docs.join(', ')};` : ''}
            {reqMiss.comment ? ' требуется комментарий.' : ''}
          </div>
        )}
        <div className="pc-acts">
          {allowedActions.length === 0
            ? <div className="act-none">{(req.available_actions || []).length ? 'Нет прав на действия этой стадии.' : 'Доступных действий нет.'}</div>
            : allowedActions.map((a) => {
              const cls = a.kind === 'approve' ? 'act ok' : a.kind === 'reject' ? 'act bad' : 'act ghost';
              const Icon = a.kind === 'approve' ? Check : a.kind === 'correction' ? Flag : null;
              return <button key={a.action_key} className={cls} disabled={pending} onClick={() => onAction(a.action_key)}>{Icon && <Icon className="lucide" />} {a.label || a.action_key}</button>;
            })}
        </div>
      </>
    );
  } else {
    // done / wait — только сведения об этапе
    body = (
      <>
        <div className="pc-sec">Ответственный за этап</div>
        <WhoBlockInner req={req} canChange={canChange} onPick={onAssign} roleFallback={roleFallback} />
        {subject}
      </>
    );
  }

  return (
    <div className="pcard">
      <div className="pc-kick">{kick}</div>
      <div className="pc-titlerow"><h2 className="pc-title">{s.name}</h2>{badge}</div>
      <div className="pc-desc">{desc}</div>
      {body}
    </div>
  );
}

/* ── блок ответственного (обёртка с секцией — для вкладки «Данные») ── */
function WhoBlock({ req, canChange, onPick, roleFallback, label }) {
  return (
    <>
      {label && <div className="sec">{label}</div>}
      <WhoBlockInner req={req} canChange={canChange} onPick={onPick} roleFallback={roleFallback} />
    </>
  );
}
/* ── сам виджет ответственного (+ смена) ── */
function WhoBlockInner({ req, canChange, onPick, roleFallback }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="who" ref={ref}>
        <span className="av" style={avStyle(req.who)}>{req.av}</span>
        <div style={{ minWidth: 0 }}><div className="nm">{req.who}</div><div className="rl">{req.assignee_dept || roleFallback}</div></div>
        {canChange && <button className="pk" onClick={() => setOpen(true)}>Сменить</button>}
      </div>
      {open && <AssigneePicker anchorRef={ref} currentId={req.assignee_user_id} onPick={(u) => { setOpen(false); onPick(u); }} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ── композер комментария (вкладка «Данные») ── */
function Composer({ onSend, onAttach, pending }) {
  const [text, setText] = useState('');
  const submit = () => { const t = text.trim(); if (!t) return; onSend(t); setText(''); };
  return (
    <div className="composer">
      <div className="cap">Комментарий</div>
      <textarea className="cin" rows={1} value={text} placeholder="Оставьте комментарий…" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
      <div className="bar">
        <button className="comp-attach" onClick={onAttach}><Paperclip className="lucide" /> Вложить файл</button>
        <button className="send" disabled={!text.trim() || pending} onClick={submit}>Отправить</button>
      </div>
    </div>
  );
}

/* ── лента событий (аудит + сообщения), группировка по дням ── */
function Feed({ events }) {
  if (!events.length) return <div className="feed-empty">Событий пока нет.</div>;
  const groups = []; let cur = null;
  for (const e of events) { const day = dayLabel(e.t); if (!cur || cur.day !== day) { cur = { day, items: [] }; groups.push(cur); } cur.items.push(e); }
  return (
    <div>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="daydiv"><span className="lbl">{g.day}</span><span className="ln" /></div>
          <div>{g.items.map((e) => <FeedRow key={e.kind + e.data.id} e={e} />)}</div>
        </div>
      ))}
    </div>
  );
}
function FeedRow({ e }) {
  if (e.kind === 'msg') {
    const m = e.data;
    return (
      <div className="tl-i">
        <span className="tl-av" style={avStyle(m.author_name)}>{initials(m.author_name)}</span>
        <div className="tl-c">
          <div className="tl-h"><b>{m.author_name || 'Система'}</b> <span className="tl-tag">Комментарий</span> <em>{hm(m.created_at)}</em></div>
          <div className="tl-bubble">{m.body}</div>
        </div>
      </div>
    );
  }
  const a = e.data;
  if (a.type === 'transition') {
    return (
      <div className="tl-i">
        <span className="tl-dot"><Flag className="lucide" /></span>
        <div className="tl-c">
          <div className="tl-h">Стадия изменена <em>{hm(a.created_at)}</em></div>
          <div className="tl-chips"><span className="schip">{a.from_name || '—'}</span><span className="arr">→</span><span className="schip cur">{a.to_name}</span></div>
        </div>
      </div>
    );
  }
  if (a.type === 'document') {
    return (
      <div className="tl-i">
        <span className="tl-dot"><Paperclip className="lucide" /></span>
        <div className="tl-c"><div className="tl-h"><b>{a.actor_name || 'Система'}</b> · документы обновлены <em>{hm(a.created_at)}</em></div></div>
      </div>
    );
  }
  const label = a.type === 'created' ? 'создал заявку'
    : a.type === 'system' ? (a.payload?.rule ? `правило: ${a.payload.rule}` : a.payload?.assignee ? `сменил ответственного → ${a.payload.assignee}` : 'системное событие')
    : a.type;
  return (
    <div className="tl-i">
      <span className="tl-av" style={avStyle(a.actor_name)}>{initials(a.actor_name)}</span>
      <div className="tl-c"><div className="tl-h"><b>{a.actor_name || 'Система'}</b> · {label} <em>{hm(a.created_at)}</em></div></div>
    </div>
  );
}

/* ── дропзона документов ── */
function DropZone({ onFiles, pending }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);
  return (
    <>
      <div className={'dropzone' + (drag ? ' drag' : '')} onClick={() => ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}>
        <span className="di"><Upload className="lucide" /></span>
        <span className="dt">{pending ? 'Загрузка…' : 'Перетащите файлы или нажмите для выбора'}<small>PDF, DOCX, XLSX, JPG · доступны на всех этапах</small></span>
      </div>
      <input ref={ref} type="file" multiple hidden onChange={(e) => { if (e.target.files.length) onFiles(e.target.files); e.target.value = ''; }} />
    </>
  );
}

/* ── чат ── */
function Chat({ messages, me, onSend, onAttach }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);
  const submit = () => { const t = text.trim(); if (!t) return; onSend(t); setText(''); };
  return (
    <div className="view chat-room">
      <div className="chat-inner">
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-sys">Чат по заявке</div>
          {messages.map((m) => {
            const mine = m.author_user_id === me?.id;
            return (
              <div key={m.id} className={'cmsg ' + (mine ? 'me' : 'them')}>
                <span className="cav" style={mine ? undefined : avStyle(m.author_name)}>{initials(m.author_name)}</span>
                <div className="cwrap">
                  {!mine && <div className="cname">{m.author_name}</div>}
                  <div className="cbub">{m.body}</div>
                  <div className="ctime">{hm(m.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="chat-input">
          <button className="chat-attach" title="Прикрепить файл" onClick={onAttach}><Paperclip className="lucide" /></button>
          <textarea rows={1} value={text} placeholder="Написать сообщение по заявке…" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="chat-send" title="Отправить" onClick={submit}><Send className="lucide" /></button>
        </div>
      </div>
    </div>
  );
}
