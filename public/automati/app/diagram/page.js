"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import { ArrowLeft, Check, Loader2, Rocket, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const starterNodes = [
  {
    id: "intent",
    type: "input",
    position: { x: 40, y: 160 },
    data: { label: "Automation intent", kind: "intent", toolId: "", description: "Build a pipeline from the user prompt." }
  },
  {
    id: "output",
    type: "output",
    position: { x: 700, y: 160 },
    data: { label: "Retrieve output", kind: "output", toolId: "", description: "Fetch run and sync results." }
  }
];

const starterEdges = [{ id: "intent-output", source: "intent", target: "output", animated: true }];

async function api(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

export default function DiagramPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(starterNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(starterEdges);
  const [context, setContext] = useState({ prompt: "", tools: [] });
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [loading, setLoading] = useState("");
  const [statusMessage, setStatusMessage] = useState("Click a source or destination node to authorize it.");
  const [toolConfigs, setToolConfigs] = useState({});
  const [modalNode, setModalNode] = useState(null);
  const [modalFields, setModalFields] = useState([]);
  const [modalValues, setModalValues] = useState({});
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    const storedPipeline = localStorage.getItem("syncy.pipeline");
    const storedContext = localStorage.getItem("syncy.context");
    const storedConfigs = localStorage.getItem("syncy.toolConfigs");
    let loadedNodes = starterNodes;
    let loadedEdges = starterEdges;

    if (storedPipeline) {
      const pipeline = JSON.parse(storedPipeline);
      loadedNodes = pipeline.nodes?.length ? pipeline.nodes : starterNodes;
      loadedEdges = pipeline.edges?.length ? pipeline.edges : starterEdges;
      setNodes(loadedNodes);
      setEdges(loadedEdges);
    }
    if (storedContext) setContext(JSON.parse(storedContext));
    if (storedConfigs) setToolConfigs(JSON.parse(storedConfigs));
  }, [setEdges, setNodes]);

  useEffect(() => {
    localStorage.setItem("syncy.pipeline", JSON.stringify({ nodes, edges }));
  }, [nodes, edges]);

  useEffect(() => {
    localStorage.setItem("syncy.toolConfigs", JSON.stringify(toolConfigs));
  }, [toolConfigs]);

  const onConnect = useCallback(
    (params) => setEdges((current) => addEdge({ ...params, animated: true }, current)),
    [setEdges]
  );

  const onSelectionChange = useCallback(({ nodes: pickedNodes, edges: pickedEdges }) => {
    setSelectedNodes(pickedNodes);
    setSelectedEdges(pickedEdges);
  }, []);

  const deleteSelection = useCallback(() => {
    const nodeIds = new Set(selectedNodes.map((node) => node.id));
    const edgeIds = new Set(selectedEdges.map((edge) => edge.id));
    setNodes((current) => current.filter((node) => !nodeIds.has(node.id)));
    setEdges((current) => current.filter((edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)));
  }, [selectedEdges, selectedNodes, setEdges, setNodes]);

  async function openToolModal(event, node) {
    const kind = node.data?.kind;
    if (kind !== "source" && kind !== "destination") return;
    setModalNode(node);
    setModalFields([]);
    setModalValues(toolConfigs[node.id] || toolConfigs[node.data?.toolId] || {});
    setModalLoading(true);
    try {
      const response = await fetch(`/api/tool-fields?toolId=${encodeURIComponent(node.data.toolId)}`);
      const data = await response.json();
      setModalFields(data.fields || []);
    } catch {
      setModalFields([{ key: "api_key", label: "API key or access token", type: "password", required: true, placeholder: "credential" }]);
    } finally {
      setModalLoading(false);
    }
  }

  function saveToolConfig() {
    if (!modalNode) return;
    const nextConfigs = {
      ...toolConfigs,
      [modalNode.id]: modalValues,
      [modalNode.data.toolId]: modalValues
    };
    setToolConfigs(nextConfigs);
    setStatusMessage(`${modalNode.data.label || modalNode.data.toolId} authorized.`);
    setModalNode(null);
  }

  async function runPipeline(graph = { nodes, edges }) {
    const missing = missingToolConfigs(graph.nodes, toolConfigs);
    if (missing.length) {
      setStatusMessage(`Authorize ${missing.map((node) => node.data?.label || node.data?.toolId).join(", ")} before running.`);
      setModalNode(missing[0]);
      openToolModal(null, missing[0]);
      return;
    }

    setLoading("run");
    try {
      const data = await api("/api/run", {
        pipeline: graph,
        configs: toolConfigs
      });
      if (data.missingAuthorization?.length) {
        setStatusMessage(data.message);
        return;
      }
      setStatusMessage(data.started ? runMessage(data.result) : data.message);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setLoading("");
    }
  }

  return (
    <main className="diagram-shell">
      <header className="diagram-topbar">
        <div>
          <Link href="/" className="back-link"><ArrowLeft size={17} /> Syncy</Link>
          <h1>Pipeline diagram</h1>
        </div>
        <div className="powered-outline dark">Powered by fivetran.com</div>
      </header>

      <section className="diagram-layout">
        <section className="diagram-stage">
          <div className="diagram-toolbar">
            <div>
              <h2>Drag, connect, delete</h2>
              <p>{statusMessage}</p>
            </div>
            <div className="toolbar-actions">
              <button className="ghost" type="button" onClick={deleteSelection} disabled={!selectedNodes.length && !selectedEdges.length}>
                <Trash2 size={17} />
                Delete
              </button>
              <button className="primary" type="button" onClick={() => runPipeline()}>
                {loading === "run" ? <Loader2 className="spin" size={17} /> : <Rocket size={17} />}
                Run
              </button>
            </div>
          </div>

          <div className="flow-wrap diagram-flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={openToolModal}
              onSelectionChange={onSelectionChange}
              deleteKeyCode={["Backspace", "Delete"]}
              fitView
            >
              <MiniMap pannable zoomable />
              <Controls />
              <Background />
            </ReactFlow>
          </div>
        </section>

      </section>
      {modalNode ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="auth-modal">
            <div className="modal-title">
              <div>
                <h2>Authorize {modalNode.data?.label || modalNode.data?.toolId}</h2>
                <p>{modalNode.data?.description || "Supply the fields required for this tool."}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setModalNode(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {modalLoading ? (
              <div className="modal-loading"><Loader2 className="spin" size={18} /> Loading fields</div>
            ) : (
              <div className="modal-fields">
                {modalFields.map((field) => (
                  <label key={field.key}>
                    {field.label}{field.required ? " *" : ""}
                    <input
                      type={field.type === "password" ? "password" : "text"}
                      value={modalValues[field.key] || ""}
                      placeholder={field.placeholder || ""}
                      onChange={(event) => setModalValues((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={() => setModalNode(null)}>Cancel</button>
              <button className="primary" type="button" onClick={saveToolConfig} disabled={modalLoading || !hasRequiredFields(modalFields, modalValues)}>
                <Check size={17} />
                Authorize tool
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function missingToolConfigs(nodes, configs) {
  const missing = [];
  for (const node of nodes) {
    const kind = node.data?.kind;
    if ((kind === "source" || kind === "destination") && node.data?.toolId && !configs[node.id] && !configs[node.data.toolId]) {
      missing.push(node);
    }
  }
  return missing;
}

function runMessage(result) {
  if (!result) return "Run started.";
  if (result.mode === "live") return "Run started through Fivetran.";
  return result.message || "Run prepared.";
}

function hasRequiredFields(fields, values) {
  return fields.every((field) => !field.required || String(values[field.key] || "").trim());
}
