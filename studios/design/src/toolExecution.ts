import type { AgentContext, Execution, ToolCallInput, ToolCallOutcome } from './host.ts'

type DispatchOutcome = { kind: 'post-result' | 'final-result'; result: ToolCallOutcome }
type Prepared = { kind: 'dispatch'; exec: Execution } | (DispatchOutcome & { exec: Execution })
interface Pipeline {
  prepare(input: ToolCallInput): Promise<Prepared>
  dispatch(execution: Execution): Promise<DispatchOutcome>
  complete(execution: Execution, outcome: DispatchOutcome): Promise<ToolCallOutcome>
}

/**
 * 步骤开始时解析的准入集合只含当时可见的工具；设计任务里 MasterGo 是在 design_workspace 运行中才为该 Agent 连上的，
 * 它的作用域工具不在集合里，原样传集合会被宿主判为 unknown tool。名称不在集合里时省略集合，让宿主按作用域注册表解析，
 * 与旧版 ctx.tools.execute 行为一致；带 when 条件的注册在没有准入集合时仍不可用，不会被绕过。
 */
function admission(owner: Execution, name: string): object | undefined {
  const set = owner.toolSet as { view?(scope: unknown): ReadonlyMap<string, unknown> } | undefined
  if (!set || typeof set.view !== 'function') return set
  return set.view(owner.agent).has(name) ? set : undefined
}

/**
 * 从宿主同版本模块创建串行嵌套调用器；每次完整执行策略、派发与结果阶段。
 * @param ctx 宿主上下文，提供作用域工具注册与审批事件。
 * @param owner 外层工具运行上下文，接收延后消息与结束标记。
 * @returns 保留父令牌、步骤准入及取消信号的调用器。
 */
export async function nestedToolExecutor(ctx: AgentContext, owner: Execution): Promise<(input: ToolCallInput) => Promise<ToolCallOutcome>> {
  const specifier = '@deepseek-ai/dsh-tools/pipeline'
  const module: { ToolExecutionPipeline: new (ctx: AgentContext) => Pipeline } = await import(specifier)
  const pipeline = new module.ToolExecutionPipeline(ctx)
  return async input => {
    const prepared = await pipeline.prepare({ ...input, agent: owner.agent, parent: owner.token, rootCallId: owner.rootCallId, toolSet: admission(owner, input.name), signal: AbortSignal.any([owner.signal, input.signal]) })
    const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
    const result = await pipeline.complete(prepared.exec, outcome)
    for (const context of result.additionalContexts ?? []) owner.deferContext(context)
    if (!result.isError && result.concludesTurn) owner.concludeTurn()
    return result
  }
}
