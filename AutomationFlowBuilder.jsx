import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, Controls, Background, applyNodeChanges, applyEdgeChanges, addEdge, MiniMap, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './FlowNodes';
import { Plus, Save, X, Settings, Zap, Filter, Activity, Trash2, Globe, Send, Mail, MessageCircle, Repeat } from 'lucide-react';
import toast from 'react-hot-toast';

function BuilderCanvas({ rule, metadata, onSave, onCancel }) {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const { screenToFlowPosition } = useReactFlow();

  // Initialize graph
  useEffect(() => {
    if (rule?.graphData) {
      try {
        const { nodes: parsedNodes, edges: parsedEdges } = JSON.parse(rule.graphData);
        setNodes(parsedNodes || []);
        setEdges(parsedEdges || []);
        return;
      } catch (e) {
        console.error('Error parsing graphData', e);
      }
    }

    if (rule) {
      // Classic init
      let initialNodes = [];
      let initialEdges = [];
      let yPos = 50;

      // 1. Trigger
      initialNodes.push({
        id: 'trigger',
        type: 'trigger',
        position: { x: 250, y: yPos },
        data: { 
          label: rule.triggers ? 'События' : getTriggerLabel(rule.triggerType), 
          description: `Сущность: ${rule.entityType}`,
          triggers: rule.triggers ? (typeof rule.triggers === 'string' ? JSON.parse(rule.triggers) : rule.triggers) : [{ type: rule.triggerType || 'stage_changed' }],
          entityType: rule.entityType || 'deal'
        }
      });

      yPos += 150;
      let lastNodeId = 'trigger';

      // 2. Conditions
      const conds = rule.conditions ? (typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions) : [];
      if (conds && conds.length > 0) {
        const condId = 'conditions_1';
        initialNodes.push({
          id: condId,
          type: 'condition',
          position: { x: 250, y: yPos },
          data: {
            label: 'Условие',
            condition: formatConditions(conds),
            rawConditions: conds
          }
        });
        initialEdges.push({ id: `e-${lastNodeId}-${condId}`, source: lastNodeId, target: condId, animated: true });
        lastNodeId = condId;
        yPos += 150;
      }

      // 3. Actions
      const acts = rule.actions ? (typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions) : [];
      if (acts && acts.length > 0) {
        acts.forEach((action, index) => {
          const actionId = `action_${index}`;
          initialNodes.push({
            id: actionId,
            type: 'action',
            position: { x: 250, y: yPos },
            data: {
              label: getActionLabel(action.type),
              actionType: action.type,
              description: action.config?.message || action.config?.title || action.config?.field || '',
              config: action.config || {}
            }
          });

          if (lastNodeId.startsWith('condition')) {
            initialEdges.push({ id: `e-${lastNodeId}-yes-${actionId}`, source: lastNodeId, sourceHandle: 'yes', target: actionId });
          } else {
            initialEdges.push({ id: `e-${lastNodeId}-${actionId}`, source: lastNodeId, target: actionId });
          }

          lastNodeId = actionId;
          yPos += 150;
        });
      }

      setNodes(initialNodes);
      setEdges(initialEdges);
    } else {
      // Empty new rule
      setNodes([{
        id: 'trigger',
        type: 'trigger',
        position: { x: 250, y: 50 },
        data: { label: 'Смена стадии', description: 'Сущность: Сделка', triggers: [{ type: 'stage_changed' }], entityType: 'deal' }
      }]);
    }
  }, [rule]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), []);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();

    const type = event.dataTransfer.getData('application/reactflow/type');
    const subType = event.dataTransfer.getData('application/reactflow/subType');
    
    if (typeof type === 'undefined' || !type) return;

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNode = {
      id: `node_${Date.now()}`,
      type,
      position,
      data: { 
        label: subType ? getActionLabel(subType) : 'Новый узел',
        actionType: subType,
        config: {},
        rawConditions: []
      },
    };

    setNodes((nds) => nds.concat(newNode));
  }, [screenToFlowPosition]);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const updateSelectedNodeData = (newData) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNode.id) {
          const updated = { ...n, data: { ...n.data, ...newData } };
          setSelectedNode(updated); // Update local state for sidebar
          return updated;
        }
        return n;
      })
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    if (selectedNode.id === 'trigger') return toast.error('Нельзя удалить стартовый триггер');
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  };

  const handleSaveGraph = () => {
    const graphData = JSON.stringify({ nodes, edges });
    
    // Convert to linear structure for classic engine if mode isn't agent
    const triggerNode = nodes.find(n => n.type === 'trigger');
    if (!triggerNode) return toast.error('Процесс должен содержать триггер');

    let isAgentMode = rule?.mode === 'agent' || nodes.some(n => n.data.actionType?.startsWith('ai_'));
    
    // Basic topological sort for linear execution (simplified: assumes top-down edges)
    // Find conditions and actions by following edges from trigger
    let conditions = [];
    let actions = [];

    // Follow path from trigger
    let currentId = triggerNode.id;
    let visited = new Set();
    
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const outgoingEdges = edges.filter(e => e.source === currentId);
      if (outgoingEdges.length === 0) break;
      
      // Assume linear flow for now, take the first edge (or the 'yes' edge)
      const nextEdge = outgoingEdges.find(e => e.sourceHandle === 'yes') || outgoingEdges[0];
      const nextNode = nodes.find(n => n.id === nextEdge.target);
      
      if (!nextNode) break;

      if (nextNode.type === 'condition') {
        if (nextNode.data.rawConditions) conditions.push(...nextNode.data.rawConditions);
      } else if (nextNode.type === 'action') {
        actions.push({
          id: nextNode.id,
          type: nextNode.data.actionType,
          config: nextNode.data.config || {}
        });
      }

      currentId = nextNode.id;
    }

    const payload = {
      ...rule,
      name: rule?.name || 'Новый бизнес-процесс',
      entityType: triggerNode.data.entityType || 'deal',
      triggers: JSON.stringify(triggerNode.data.triggers || [{ type: 'stage_changed' }]),
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
      graphData,
      mode: isAgentMode ? 'agent' : 'classic'
    };

    onSave(payload);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', background: 'var(--surface)', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-ghost" onClick={onCancel} style={{ padding: 8 }}>
            <X size={20} />
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text)' }}>{rule?.name || 'Новый процесс'}</h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Визуальный конструктор</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={handleSaveGraph}>
            <Save size={16} /> Сохранить процесс
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative' }} ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={() => {}}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background color="var(--glass-border)" gap={16} />
            <Controls />
            <MiniMap 
              nodeColor={(node) => {
                if (node.type === 'trigger') return 'var(--success)';
                if (node.type === 'condition') return 'var(--warning)';
                if (node.data?.actionType?.startsWith('ai_')) return '#6c5ce7';
                return 'var(--primary)';
              }} 
              maskColor="rgba(0,0,0,0.1)"
            />
          </ReactFlow>
        </div>

        {/* Sidebar */}
        <div style={{ width: '320px', background: 'var(--surface-solid)', borderLeft: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
          {selectedNode ? (
            // Properties Panel
            <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text)' }}>Настройки узла</h3>
                <button onClick={() => setSelectedNode(null)} className="btn btn-ghost" style={{ padding: 4 }}><X size={16} /></button>
              </div>

              {selectedNode.type === 'trigger' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>Сущность</label>
                    <select 
                      className="form-control" 
                      value={selectedNode.data.entityType || 'deal'}
                      onChange={(e) => updateSelectedNodeData({ entityType: e.target.value, description: `Сущность: ${e.target.value}` })}
                    >
                      <option value="deal">Сделка</option>
                      <option value="client">Клиент</option>
                      <option value="task">Задача</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>События (ИЛИ)</label>
                    <button className="btn btn-secondary" style={{ marginBottom: 10, width: '100%' }} onClick={() => {
                      const trigs = selectedNode.data.triggers || [];
                      updateSelectedNodeData({ triggers: [...trigs, { type: 'field_updated' }], label: 'Множество событий' });
                    }}>Добавить событие</button>
                    
                    {(selectedNode.data.triggers || [{ type: 'stage_changed' }]).map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <select 
                          className="form-control" 
                          value={t.type}
                          onChange={(e) => {
                            let trigs = [...selectedNode.data.triggers];
                            trigs[i].type = e.target.value;
                            updateSelectedNodeData({ triggers: trigs, label: getTriggerLabel(trigs[0].type) + (trigs.length > 1 ? ' + ' + (trigs.length - 1) : '') });
                          }}
                        >
                          <option value="stage_changed">Смена стадии</option>
                          <option value="entity_created">Создание объекта</option>
                          <option value="field_updated">Изменение поля</option>
                          <option value="message_received">Входящее сообщение</option>
                        </select>
                        <button className="btn btn-ghost" style={{ padding: '0 8px', color: 'var(--danger)' }} onClick={() => {
                           let trigs = [...selectedNode.data.triggers];
                           trigs.splice(i, 1);
                           if (trigs.length === 0) trigs.push({ type: 'stage_changed' });
                           updateSelectedNodeData({ triggers: trigs });
                        }}><X size={16} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedNode.type === 'action' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>Тип действия</label>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: 8, color: 'var(--text)', fontSize: '0.9rem' }}>
                      {getActionLabel(selectedNode.data.actionType)}
                    </div>
                  </div>
                  
                  {/* Dynamic Action Config Fields */}
                  {selectedNode.data.actionType === 'create_task' && (
                    <>
                      <div>
                        <label className="form-label">Название задачи</label>
                        <input className="form-control" type="text" value={selectedNode.data.config?.title || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, title: e.target.value }, description: e.target.value })} />
                      </div>
                      <div>
                        <label className="form-label">Менеджер (ID)</label>
                        <input className="form-control" type="text" value={selectedNode.data.config?.assigneeId || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, assigneeId: e.target.value } })} />
                      </div>
                    </>
                  )}

                  {selectedNode.data.actionType === 'send_notification' && (
                    <>
                      <div>
                        <label className="form-label">Текст уведомления</label>
                        <textarea className="form-control" value={selectedNode.data.config?.message || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, message: e.target.value }, description: e.target.value })} />
                      </div>
                    </>
                  )}

                  {selectedNode.data.actionType === 'ai_generate' && (
                    <>
                      <div>
                        <label className="form-label">Prompt для ИИ</label>
                        <textarea className="form-control" rows={4} value={selectedNode.data.config?.prompt || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, prompt: e.target.value }, description: 'AI Генерация' })} />
                      </div>
                    </>
                  )}

                  {selectedNode.data.actionType === 'http_request' && (
                    <>
                      <div>
                        <label className="form-label">Метод</label>
                        <select className="form-control" value={selectedNode.data.config?.method || 'GET'} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, method: e.target.value } })}>
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-label">URL запроса</label>
                        <input className="form-control" type="text" placeholder="https://api.example.com" value={selectedNode.data.config?.url || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, url: e.target.value }, description: e.target.value })} />
                      </div>
                      <div>
                        <label className="form-label">Headers (JSON)</label>
                        <textarea className="form-control" rows={2} placeholder='{"Authorization": "Bearer token"}' value={typeof selectedNode.data.config?.headers === 'object' ? JSON.stringify(selectedNode.data.config.headers) : (selectedNode.data.config?.headers || '')} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, headers: e.target.value } })} />
                      </div>
                      <div>
                        <label className="form-label">Body (JSON)</label>
                        <textarea className="form-control" rows={3} placeholder='{"status": "{{deal.stageId}}"}' value={typeof selectedNode.data.config?.body === 'object' ? JSON.stringify(selectedNode.data.config.body) : (selectedNode.data.config?.body || '')} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, body: e.target.value } })} />
                      </div>
                      <div>
                        <label className="form-label">Сохранить результат в переменную (опционально)</label>
                        <input className="form-control" type="text" placeholder="httpResponse" value={selectedNode.data.config?.saveResponseTo || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, saveResponseTo: e.target.value } })} />
                      </div>
                    </>
                  )}

                  {selectedNode.data.actionType === 'wait_webhook' && (
                    <>
                      <div>
                        <label className="form-label">Макс. ожидание (в днях)</label>
                        <input className="form-control" type="number" value={selectedNode.data.config?.timeoutDays || 7} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, timeoutDays: parseInt(e.target.value) }, description: `Ждать ${e.target.value} дн.` })} />
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Секретный URL будет сгенерирован автоматически во время выполнения процесса.
                      </div>
                    </>
                  )}

                  {/* Integration message nodes config */}
                  {['send_telegram', 'send_whatsapp', 'send_email', 'send_instagram', 'send_facebook'].includes(selectedNode.data.actionType) && (
                    <>
                      <div>
                        <label className="form-label">Текст сообщения</label>
                        <textarea className="form-control" rows={4} placeholder="Здравствуйте, {{client.firstName}}! Ваша сделка на сумму {{deal.amount}} обновлена." value={selectedNode.data.config?.message || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, message: e.target.value }, description: e.target.value.substring(0, 40) + '...' })} />
                      </div>
                      {selectedNode.data.actionType === 'send_email' && (
                        <div>
                          <label className="form-label">Тема письма</label>
                          <input className="form-control" type="text" placeholder="Обновление по сделке {{deal.title}}" value={selectedNode.data.config?.subject || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, subject: e.target.value } })} />
                        </div>
                      )}
                    </>
                  )}

                  {/* Loop node config */}
                  {selectedNode.data.actionType === 'loop' && (
                    <>
                      <div>
                        <label className="form-label">Макс. итераций</label>
                        <input className="form-control" type="number" value={selectedNode.data.config?.maxIterations || 5} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, maxIterations: parseInt(e.target.value) }, description: `Макс. ${e.target.value} итераций` })} />
                      </div>
                      <div>
                        <label className="form-label">Условие выхода (поле)</label>
                        <input className="form-control" type="text" placeholder="deal.amount" value={selectedNode.data.config?.exitField || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, exitField: e.target.value } })} />
                      </div>
                      <div>
                        <label className="form-label">Оператор</label>
                        <select className="form-control" value={selectedNode.data.config?.exitOperator || 'greater'} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, exitOperator: e.target.value } })}>
                          <option value="equals">Равно</option>
                          <option value="not_equals">Не равно</option>
                          <option value="greater">Больше</option>
                          <option value="less">Меньше</option>
                          <option value="filled">Заполнено</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Значение для сравнения</label>
                        <input className="form-control" type="text" placeholder="3" value={selectedNode.data.config?.exitValue || ''} onChange={(e) => updateSelectedNodeData({ config: { ...selectedNode.data.config, exitValue: e.target.value } })} />
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Цикл будет повторять действия между этим узлом и следующим узлом "Пауза", пока условие не выполнится (или не исчерпается лимит итераций).
                      </div>
                    </>
                  )}

                  {/* Variables Helper Snippet for all Actions */}
                  <div style={{ marginTop: 10, padding: 12, background: 'var(--primary-glow)', borderRadius: 8, border: '1px dashed var(--primary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, marginBottom: 8 }}>Доступные переменные (Интерполяция):</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Используйте <code>{`{{deal.amount}}`}</code>, <code>{`{{client.phone}}`}</code>, <code>{`{{httpResponse.data.id}}`}</code> в текстовых полях.
                    </div>
                  </div>
                </div>
              )}

              {selectedNode.type === 'condition' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Условия фильтрации</div>
                  <button className="btn btn-secondary" onClick={() => {
                    const rc = selectedNode.data.rawConditions || [];
                    updateSelectedNodeData({ rawConditions: [...rc, { field: 'amount', operator: 'greater', value: '1000' }] });
                  }}>Добавить поле</button>
                  {/* Simplistic condition edit */}
                  {(selectedNode.data.rawConditions || []).map((c, i) => (
                    <div key={i} style={{ background: 'var(--bg)', padding: 10, borderRadius: 8 }}>
                       <input className="form-control" style={{marginBottom: 8}} value={c.field} onChange={e => {
                         let rc = [...selectedNode.data.rawConditions]; rc[i].field = e.target.value; updateSelectedNodeData({rawConditions: rc});
                       }} placeholder="Поле" />
                       <input className="form-control" value={c.value} onChange={e => {
                         let rc = [...selectedNode.data.rawConditions]; rc[i].value = e.target.value; updateSelectedNodeData({rawConditions: rc, condition: `${rc[0].field} > ${rc[0].value}`});
                       }} placeholder="Значение" />
                    </div>
                  ))}
                </div>
              )}

              <button 
                onClick={deleteSelectedNode} 
                className="btn btn-ghost" 
                style={{ width: '100%', marginTop: 32, color: 'var(--danger)', border: '1px solid rgba(255,59,48,0.2)' }}
              >
                <Trash2 size={16} /> Удалить узел
              </button>
            </div>
          ) : (
            // Palette / Toolbox
            <div style={{ padding: 20, flex: 1 }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 1 }}>Палитра узлов</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>Перетащите узлы на рабочую область</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'condition'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--warning)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <Filter size={18} style={{ color: 'var(--warning)' }} /> Условие (Filter)
                </div>

                <div style={{ height: 1, background: 'var(--glass-border)', margin: '10px 0' }} />

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'create_task'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <Activity size={18} style={{ color: 'var(--primary)' }} /> Создать задачу
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'send_notification'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <Activity size={18} style={{ color: 'var(--primary)' }} /> Уведомление
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'change_stage'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <Activity size={18} style={{ color: 'var(--primary)' }} /> Сменить стадию
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'http_request'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <Globe size={18} style={{ color: 'var(--primary)' }} /> HTTP Запрос
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'wait_webhook'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <Zap size={18} style={{ color: 'var(--warning)' }} /> Ждать Webhook
                </div>

                <div style={{ height: 1, background: 'var(--glass-border)', margin: '10px 0' }} />

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'ai_generate'); }} draggable style={{ padding: '12px 16px', background: 'rgba(108,92,231,0.1)', border: '1px solid #6c5ce7', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: '#6c5ce7', fontWeight: 600 }}>
                  <Zap size={18} /> AI Генерация
                </div>

                <div style={{ height: 1, background: 'var(--glass-border)', margin: '10px 0' }} />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>ИНТЕГРАЦИИ</div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'send_telegram'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid #0088cc', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: '#0088cc' }}>
                  <Send size={18} /> Telegram
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'send_whatsapp'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid #25D366', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: '#25D366' }}>
                  <MessageCircle size={18} /> WhatsApp
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'send_email'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid #EA4335', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: '#EA4335' }}>
                  <Mail size={18} /> Email (Gmail)
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'send_instagram'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid #E4405F', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: '#E4405F' }}>
                  <Send size={18} /> Instagram Direct
                </div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'send_facebook'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid #1877F2', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: '#1877F2' }}>
                  <MessageCircle size={18} /> Facebook Messenger
                </div>

                <div style={{ height: 1, background: 'var(--glass-border)', margin: '10px 0' }} />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>ЛОГИКА</div>

                <div className="dndnode" onDragStart={(event) => { event.dataTransfer.setData('application/reactflow/type', 'action'); event.dataTransfer.setData('application/reactflow/subType', 'loop'); }} draggable style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--warning)', borderRadius: 12, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--warning)' }}>
                  <Repeat size={18} /> Цикл (Loop)
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AutomationFlowBuilder(props) {
  return (
    <ReactFlowProvider>
      <BuilderCanvas {...props} />
    </ReactFlowProvider>
  );
}

// Helpers
function getTriggerLabel(type) {
  const map = {
    stage_changed: 'Смена стадии',
    entity_created: 'Создание сущности',
    field_updated: 'Изменение поля',
    message_received: 'Входящее сообщение'
  };
  return map[type] || type;
}

function getActionLabel(type) {
  const map = {
    send_notification: 'Уведомление',
    create_task: 'Создать задачу',
    change_stage: 'Сменить стадию',
    change_manager: 'Сменить ответственного',
    webhook: 'Webhook',
    http_request: 'HTTP Запрос',
    wait: 'Пауза',
    wait_webhook: 'Ждать Webhook',
    ai_generate: 'AI Генерация текста',
    ai_decision: 'AI Принятие решения',
    send_telegram: 'Telegram',
    send_whatsapp: 'WhatsApp',
    send_email: 'Email (Gmail)',
    send_instagram: 'Instagram Direct',
    send_facebook: 'Facebook Messenger',
    loop: 'Цикл (Loop)',
  };
  return map[type] || type;
}

function formatConditions(conds) {
  if (!conds || !conds.length) return '';
  return conds.map(c => `${c.field} ${c.operator} ${c.value}`).join(` ${conds[0].logic === 'or' ? 'ИЛИ' : 'И'} `);
}
