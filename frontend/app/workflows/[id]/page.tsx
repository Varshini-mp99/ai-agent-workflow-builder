"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workflow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at?: string;
};

type Step = {
  id: string;
  step_order: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
};

type StepRun = {
  id: string;
  workflow_step_id: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  workflow_step?: {
    id: string;
    step_order: number;
    name: string;
    type: string;
  };
};

type WorkflowRun = {
  id: string;
  workflow_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
  step_runs: StepRun[];
};

export default function WorkflowPage() {
  const params = useParams();
  const router = useRouter();

  const workflowId = params.id as string;

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [running, setRunning] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  async function loadWorkflow() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/workflows/${workflowId}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load workflow"
        );
      }

      setWorkflow(data.workflow);
      setSteps(data.steps || []);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load workflow."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadRuns() {
    try {
      setLoadingRuns(true);

      const response = await fetch(
        `/api/workflows/${workflowId}/runs`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load executions"
        );
      }

      setRuns(data.runs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    if (!workflowId) return;

    loadWorkflow();
    loadRuns();
  }, [workflowId]);

  async function runWorkflow() {
    try {
      setRunning(true);
      setMessage("");
      setError("");

      const response = await fetch(
        `/api/workflows/${workflowId}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to run workflow"
        );
      }

      setMessage(
        "Workflow executed successfully."
      );

      await loadRuns();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to run workflow."
      );
    } finally {
      setRunning(false);
    }
  }

  function formatDate(value: string | null) {
    if (!value) return "—";

    return new Date(value).toLocaleString();
  }

  function getStepIcon(type: string) {
    switch (type) {
      case "llm_call":
        return "AI";

      case "conditional_branch":
        return "◇";

      case "db_write":
        return "DB";

      case "notify":
        return "✉";

      case "http_request":
        return "↗";

      case "approval_gate":
        return "✓";

      default:
        return "•";
    }
  }

  function getStepColor(type: string) {
    switch (type) {
      case "llm_call":
        return "bg-violet-100 text-violet-700";

      case "conditional_branch":
        return "bg-blue-100 text-blue-700";

      case "db_write":
        return "bg-emerald-100 text-emerald-700";

      case "notify":
        return "bg-orange-100 text-orange-700";

      case "http_request":
        return "bg-cyan-100 text-cyan-700";

      case "approval_gate":
        return "bg-pink-100 text-pink-700";

      default:
        return "bg-slate-100 text-slate-700";
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case "completed":
        return "bg-emerald-100 text-emerald-700";

      case "running":
        return "bg-blue-100 text-blue-700";

      case "failed":
        return "bg-red-100 text-red-700";

      case "paused":
        return "bg-amber-100 text-amber-700";

      default:
        return "bg-slate-100 text-slate-600";
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 p-10">
        <div className="mx-auto max-w-7xl">
          <div className="animate-pulse">
            <div className="h-8 w-64 rounded bg-slate-200" />
            <div className="mt-4 h-4 w-96 rounded bg-slate-200" />
            <div className="mt-10 h-64 rounded-2xl bg-white" />
          </div>
        </div>
      </main>
    );
  }

  if (!workflow) {
    return (
      <main className="min-h-screen bg-slate-100 p-10">
        <div className="mx-auto max-w-7xl">
          <button
            onClick={() => router.push("/")}
            className="mb-6 rounded-lg border border-slate-300 bg-white px-5 py-3 font-medium hover:bg-slate-50"
          >
            ← Back to Dashboard
          </button>

          <div className="rounded-2xl bg-white p-10 shadow-sm">
            <h1 className="text-2xl font-bold text-red-600">
              Workflow not found
            </h1>

            <p className="mt-2 text-slate-500">
              {error || "The requested workflow does not exist."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const latestRun = runs[0];

  const completedSteps =
    latestRun?.step_runs?.filter(
      (step) => step.status === "completed"
    ).length || 0;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-8 py-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <button
                onClick={() => router.push("/")}
                className="mb-4 text-sm font-medium text-indigo-600 hover:underline"
              >
                ← Back to Dashboard
              </button>

              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">
                  AI
                </div>

                <div>
                  <h1 className="text-3xl font-bold">
                    {workflow.name}
                  </h1>

                  <p className="mt-1 text-slate-500">
                    {workflow.description ||
                      "Intelligent workflow automation"}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={runWorkflow}
              disabled={running}
              className="rounded-xl bg-indigo-600 px-7 py-4 font-bold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running
                ? "Running Workflow..."
                : "▶ Run Workflow"}
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-8 py-8">
        {/* Messages */}
        {message && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-700">
            <span className="font-bold">✓</span>
            {message}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            <p className="font-semibold">
              Something went wrong
            </p>
            <p className="mt-1 text-sm">
              {error}
            </p>
          </div>
        )}

        {/* Statistics */}
        <div className="grid gap-5 md:grid-cols-4">
          <InfoCard
            title="Workflow Steps"
            value={String(steps.length)}
            description="Configured steps"
          />

          <InfoCard
            title="Total Runs"
            value={String(runs.length)}
            description="Recorded executions"
          />

          <InfoCard
            title="Latest Status"
            value={
              latestRun
                ? latestRun.status
                : "Not Run"
            }
            description={
              latestRun
                ? "Latest execution"
                : "No execution yet"
            }
          />

          <InfoCard
            title="Latest Result"
            value={
              latestRun
                ? `${completedSteps}/${latestRun.step_runs.length}`
                : "—"
            }
            description="Steps completed"
          />
        </div>

        {/* Workflow Builder */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">
                Workflow Builder
              </h2>

              <p className="mt-1 text-slate-500">
                Visual execution pipeline
              </p>
            </div>

            <span className="rounded-full bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700">
              Manual Trigger
            </span>
          </div>

          {/* Trigger */}
          <div className="mt-8">
            <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white">
                  ▶
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                    Trigger
                  </p>

                  <h3 className="mt-1 text-lg font-bold">
                    Manual Trigger
                  </h3>

                  <p className="text-sm text-slate-500">
                    Start the workflow manually.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="mt-4">
            {steps.map((step, index) => (
              <div key={step.id}>
                <div className="ml-8 h-8 w-px bg-slate-300" />

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md">
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-bold ${getStepColor(
                        step.type
                      )}`}
                    >
                      {getStepIcon(step.type)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">
                            {step.type.replace(
                              "_",
                              " "
                            )}
                          </p>

                          <h3 className="mt-1 text-lg font-bold">
                            {step.name}
                          </h3>
                        </div>

                        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          Step {step.step_order}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {index === steps.length - 1 && (
                  <div className="ml-8 h-8 w-px bg-slate-300" />
                )}
              </div>
            ))}
          </div>

          {steps.length === 0 && (
            <div className="mt-8 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center">
              <p className="font-semibold text-slate-600">
                No workflow steps configured
              </p>

              <p className="mt-2 text-sm text-slate-400">
                Add workflow steps to begin automation.
              </p>
            </div>
          )}
        </div>

        {/* Execution History */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">
                Recent Executions
              </h2>

              <p className="mt-1 text-slate-500">
                Monitor workflow runs and step results.
              </p>
            </div>

            <button
              onClick={loadRuns}
              disabled={loadingRuns}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingRuns
                ? "Refreshing..."
                : "↻ Refresh"}
            </button>
          </div>

          {runs.length === 0 ? (
            <div className="mt-8 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
                ▶
              </div>

              <h3 className="mt-4 font-bold text-slate-700">
                No executions yet
              </h3>

              <p className="mt-2 text-sm text-slate-400">
                Click Run Workflow to execute this workflow.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-5">
              {runs.map((run) => {
                const totalSteps =
                  run.step_runs?.length || 0;

                const completed =
                  run.step_runs?.filter(
                    (step) =>
                      step.status === "completed"
                  ).length || 0;

                const isExpanded =
                  expandedRun === run.id;

                return (
                  <div
                    key={run.id}
                    className="overflow-hidden rounded-xl border border-slate-200"
                  >
                    {/* Run summary */}
                    <div className="p-6">
                      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${
                              run.status ===
                              "completed"
                                ? "bg-emerald-100 text-emerald-600"
                                : run.status ===
                                  "failed"
                                ? "bg-red-100 text-red-600"
                                : "bg-blue-100 text-blue-600"
                            }`}
                          >
                            {run.status ===
                            "completed"
                              ? "✓"
                              : run.status ===
                                "failed"
                              ? "!"
                              : "▶"}
                          </div>

                          <div>
                            <div className="flex items-center gap-3">
                              <h3 className="font-bold">
                                Workflow Run
                              </h3>

                              <span
                                className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusColor(
                                  run.status
                                )}`}
                              >
                                {run.status}
                              </span>
                            </div>

                            <p className="mt-1 break-all font-mono text-xs text-slate-400">
                              {run.id}
                            </p>
                          </div>
                        </div>

                        <div className="text-left md:text-right">
                          <p className="text-sm font-semibold text-slate-700">
                            {completed}/{totalSteps} steps
                            completed
                          </p>

                          <p className="mt-1 text-xs text-slate-400">
                            {formatDate(
                              run.started_at
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 md:grid-cols-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">
                            Started
                          </p>

                          <p className="mt-1 text-sm font-medium">
                            {formatDate(
                              run.started_at
                            )}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">
                            Completed
                          </p>

                          <p className="mt-1 text-sm font-medium">
                            {formatDate(
                              run.completed_at
                            )}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">
                            Result
                          </p>

                          <p className="mt-1 text-sm font-medium">
                            {completed}/{totalSteps} successful
                          </p>
                        </div>
                      </div>

                      {run.error && (
                        <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                          <strong>Error:</strong>{" "}
                          {run.error}
                        </div>
                      )}

                      <button
                        onClick={() =>
                          setExpandedRun(
                            isExpanded
                              ? null
                              : run.id
                          )
                        }
                        className="mt-5 w-full rounded-lg border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {isExpanded
                          ? "Hide Step Results ↑"
                          : "View Step Results ↓"}
                      </button>
                    </div>

                    {/* Step results */}
                    {isExpanded && (
                      <div className="border-t border-slate-200 bg-slate-50 p-6">
                        <h4 className="font-bold">
                          Step Results
                        </h4>

                        <div className="mt-4 space-y-3">
                          {run.step_runs
                            .slice()
                            .sort(
                              (a, b) =>
                                (a.workflow_step
                                  ?.step_order ||
                                  0) -
                                (b.workflow_step
                                  ?.step_order ||
                                  0)
                            )
                            .map((stepRun) => (
                              <div
                                key={stepRun.id}
                                className="rounded-xl border border-slate-200 bg-white p-5"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <div className="flex items-center gap-3">
                                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-600">
                                        {stepRun
                                          .workflow_step
                                          ?.step_order ||
                                          "?"}
                                      </span>

                                      <div>
                                        <p className="font-semibold">
                                          {stepRun
                                            .workflow_step
                                            ?.name ||
                                            "Workflow Step"}
                                        </p>

                                        <p className="text-xs uppercase text-slate-400">
                                          {stepRun
                                            .workflow_step
                                            ?.type ||
                                            "unknown"}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <span
                                    className={`rounded-full px-3 py-1 text-xs font-bold ${statusColor(
                                      stepRun.status
                                    )}`}
                                  >
                                    {
                                      stepRun.status
                                    }
                                  </span>
                                </div>

                                {stepRun.output && (
                                  <div className="mt-4">
                                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                                      Output
                                    </p>

                                    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-emerald-300">
                                      {JSON.stringify(
                                        stepRun.output,
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </div>
                                )}

                                {stepRun.error && (
                                  <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                                    {stepRun.error}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function InfoCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-slate-500">
        {title}
      </p>

      <p className="mt-3 text-3xl font-bold capitalize">
        {value}
      </p>

      <p className="mt-2 text-xs text-slate-400">
        {description}
      </p>
    </div>
  );
}