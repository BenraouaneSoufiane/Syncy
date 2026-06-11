"use client";

import { Bot, Loader2, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const fallbackTools = [
  "Salesforce", "Google Ads", "PostgreSQL", "Stripe", "HubSpot", "Shopify", "MySQL", "Facebook Ads",
  "Google Analytics", "MongoDB", "Zendesk", "LinkedIn Ads", "Snowflake", "BigQuery", "Oracle", "NetSuite",
  "Marketo", "TikTok Ads", "Slack", "Intercom", "Airtable", "GitHub", "Jira", "Mailchimp",
  "Microsoft Ads", "Amazon Ads", "Asana", "Dropbox", "Freshdesk", "Chargebee", "Braze", "Amplitude",
  "Pipedrive", "QuickBooks", "Klaviyo", "Redshift", "SQL Server", "S3", "Mixpanel", "Workday",
  "Pinterest Ads", "Typeform", "Segment", "Databricks", "PayPal", "Square", "WooCommerce", "Twilio",
  "ClickUp", "Notion", "Google Sheets", "Supabase", "LinkedIn Pages", "X Ads", "ServiceNow", "Gong", "Calendly",
  "Outreach", "Greenhouse", "Lever", "PagerDuty", "SurveyMonkey", "AdRoll", "Apple Search Ads", "Criteo"
].map((name) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  name,
  type: "Connector"
}));

function compactTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    type: tool.type,
    status: tool.status,
    description: tool.description,
    features: tool.features || []
  };
}

function chunkTools(tools) {
  const pages = [];
  for (let index = 0; index < tools.length; index += 32) pages.push(tools.slice(index, index + 32));
  return pages.length ? pages : [fallbackTools.slice(0, 32)];
}

function toolInitials(tool) {
  return (tool.name || tool.id || "Tool")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [tools, setTools] = useState(fallbackTools);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  const pages = useMemo(() => chunkTools(tools), [tools]);
  const carouselPages = useMemo(() => [...pages, pages[0]], [pages]);

  useEffect(() => {
    fetchTools("");
  }, []);

  async function fetchTools(query = prompt) {
    setLoading("tools");
    setError("");
    try {
      const response = await fetch(`/api/fivetran-tools?q=${encodeURIComponent(query)}&limit=96`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not fetch Fivetran tools.");
      setTools(data.connectors.length ? data.connectors : fallbackTools);
    } catch (err) {
      setTools(fallbackTools);
      setError("Live Fivetran tools could not be loaded, so Syncy is showing a supported-tool preview.");
    } finally {
      setLoading("");
    }
  }

  async function buildPipeline() {
    setLoading("build");
    setError("");
    try {
      const rankedTools = await getPromptTools(prompt);
      const response = await fetch("/api/ai-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          tools: rankedTools.slice(0, 48).map(compactTool)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not build pipeline.");
      localStorage.setItem("syncy.pipeline", JSON.stringify(data.pipeline));
      localStorage.setItem("syncy.context", JSON.stringify({ prompt, tools: rankedTools.slice(0, 48).map(compactTool) }));
      router.push("/diagram");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading("");
    }
  }

  async function getPromptTools(query) {
    try {
      const response = await fetch(`/api/fivetran-tools?q=${encodeURIComponent(query)}&limit=96`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not fetch prompt tools.");
      return ensurePromptTools(data.connectors.length ? data.connectors : tools, query);
    } catch {
      return ensurePromptTools(tools, query);
    }
  }

  function ensurePromptTools(candidates, query) {
    const lower = query.toLowerCase();
    const byId = new Map(candidates.map((tool) => [tool.id, tool]));
    const priorityIds = [];
    if (lower.includes("github") && !byId.has("github")) {
      byId.set("github", { id: "github", name: "GitHub", type: "Source", description: "GitHub repository, pull request, issue, and activity data." });
    }
    if (lower.includes("github")) priorityIds.push("github");
    if (lower.includes("snowflake") && !byId.has("snowflake")) {
      byId.set("snowflake", { id: "snowflake", name: "Snowflake", type: "Destination", description: "Snowflake data warehouse destination." });
    }
    if (lower.includes("snowflake")) priorityIds.push("snowflake");
    if (lower.includes("supabase") && !byId.has("supabase")) {
      byId.set("supabase", { id: "supabase", name: "Supabase", type: "Destination", description: "Supabase Postgres destination." });
    }
    if (lower.includes("supabase")) priorityIds.push("supabase");
    const priority = priorityIds.map((id) => byId.get(id)).filter(Boolean);
    const rest = [...byId.values()].filter((tool) => !priorityIds.includes(tool.id));
    return [...priority, ...rest];
  }

  return (
    <main className="home-shell">
      <section className="home-hero">
        <nav className="home-nav">
          <div className="brand-mark">Syncy</div>
          <div className="powered-outline">Powered by fivetran.com</div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <span className="kicker"><Sparkles size={16} /> AI automation builder</span>
            <h1>Syncy</h1>
            <p>
              Tell Syncy what you want to automate. It sends the right supported tools to Gemini, builds a source to
              destination pipeline, then guides authorization before the run starts.
            </p>
            <div className="trust-row">
              <span><ShieldCheck size={16} /> Secure OAuth Authorization</span>
              <span><Rocket size={16} /> Quick executable data pipeline diagram</span>
            </div>
          </div>

          <section className="build-card">
            <label htmlFor="prompt">What do you want to automate?</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={7}
              placeholder="Example: Sync Salesforce opportunities and Google Ads spend hourly, model revenue, and return a report-ready output."
            />
            <div className="action-row">
              <button className="primary" type="button" onClick={buildPipeline} disabled={!prompt.trim()}>
                {loading === "build" ? <Loader2 className="spin" size={18} /> : <Bot size={18} />}
                Submit
              </button>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </section>
        </div>
      </section>

      <section className="tools-showcase">
        <div className="section-title">
          <div>
            <h2>Supported tools</h2>
            <p>Loaded once on page open so you can see what Syncy can work with.</p>
          </div>
          <span>{loading === "tools" ? "Loading" : `${tools.length} tools`}</span>
        </div>

        <div className="carousel-viewport">
          <div className="carousel-track" style={{ "--page-count": carouselPages.length }}>
            {carouselPages.map((page, pageIndex) => (
              <div className="tool-page" key={`${pageIndex}-${page[0]?.id || "page"}`}>
                {page.map((tool) => (
                  <div
                    key={`${pageIndex}-${tool.id}`}
                    className="support-tile"
                  >
                    <div className="tool-thumb">
                      {tool.iconUrl ? <img src={tool.iconUrl} alt="" /> : <span>{toolInitials(tool)}</span>}
                    </div>
                    <div className="tool-copy">
                      <strong>{tool.name}</strong>
                      <span>{tool.type || "Connector"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
