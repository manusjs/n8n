import { Logger } from '@n8n/backend-common';
import { type IExecutionDb, type User } from '@n8n/db';
import { Service } from '@n8n/di';
import { WorkflowExecuteMode, WorkflowSettings } from 'n8n-workflow';

import type {
	ExecutionRedaction,
	ExecutionRedactionOptions,
	RedactableExecution,
} from '@/executions/execution-redaction';
import { ForbiddenError } from '@/errors/response-errors/forbidden.error';
import { WorkflowFinderService } from '@/workflows/workflow-finder.service';

import type {
	IExecutionRedactionStrategy,
	RedactionContext,
} from './execution-redaction.interfaces';
import { FullItemRedactionStrategy } from './strategies/full-item-redaction.strategy';
import { NodeDefinedFieldRedactionStrategy } from './strategies/node-defined-field-redaction.strategy';

const MANUAL_MODES: ReadonlySet<WorkflowExecuteMode> = new Set(['manual']);

/**
 * Orchestrates the execution redaction pipeline.
 *
 * Responsibilities:
 *   1. Resolve `userCanReveal` once (single DB call).
 *   2. Build a `RedactionContext` shared by all strategies.
 *   3. Construct the strategy pipeline based on policy and request options.
 *   4. Run each strategy in order; strategies own all data mutations.
 *
 * Policy evaluation and permission checks live here.
 * Data transformation lives in the strategies.
 */
@Service()
export class ExecutionRedactionService implements ExecutionRedaction {
	constructor(
		private readonly logger: Logger,
		private readonly workflowFinderService: WorkflowFinderService,
		private readonly fullItemRedactionStrategy: FullItemRedactionStrategy,
		private readonly nodeDefinedFieldRedactionStrategy: NodeDefinedFieldRedactionStrategy,
	) {}

	async init(): Promise<void> {
		this.logger.debug('Initializing ExecutionRedactionService...');
	}

	async processExecution(
		execution: IExecutionDb,
		options: ExecutionRedactionOptions,
	): Promise<IExecutionDb> {
		const policyAllowsReveal = this.policyAllowsReveal(execution);
		const userCanReveal = policyAllowsReveal || (await this.canUserReveal(options.user, execution));

		const context: RedactionContext = {
			user: options.user,
			redactExecutionData: options.redactExecutionData,
			userCanReveal,
		};

		const pipeline = this.buildPipeline(execution, context, policyAllowsReveal);
		const redactableExecution = this.toRedactableExecution(execution);

		for (const strategy of pipeline) {
			await strategy.apply(redactableExecution, context);
		}

		return execution;
	}

	/**
	 * Constructs the ordered strategy pipeline for this execution.
	 *
	 * - Reveal path (`redactExecutionData === false`): throws `ForbiddenError` if
	 *   neither policy nor user permission allows it; otherwise runs no item-clearing
	 *   strategies.
	 * - All other paths: includes `FullItemRedactionStrategy` when items should be
	 *   cleared (explicit redact, policy=all, or policy=non-manual on a non-manual mode).
	 * - `NodeDefinedFieldRedactionStrategy` is always appended last — node-declared
	 *   sensitive fields are never revealable.
	 */
	private buildPipeline(
		execution: IExecutionDb,
		context: RedactionContext,
		policyAllowsReveal: boolean,
	): IExecutionRedactionStrategy[] {
		const pipeline: IExecutionRedactionStrategy[] = [];

		if (context.redactExecutionData === false) {
			if (!policyAllowsReveal && !context.userCanReveal) {
				throw new ForbiddenError();
			}
			// No item-clearing on reveal path
		} else {
			const policy = this.resolvePolicy(execution);
			const shouldClearItems =
				context.redactExecutionData === true ||
				policy === 'all' ||
				(policy === 'non-manual' && !MANUAL_MODES.has(execution.mode));

			if (shouldClearItems) {
				pipeline.push(this.fullItemRedactionStrategy);
			}
		}

		// NodeDefinedFieldRedactionStrategy runs in all cases — including reveal path
		pipeline.push(this.nodeDefinedFieldRedactionStrategy);

		return pipeline;
	}

	private toRedactableExecution(execution: IExecutionDb): RedactableExecution {
		return {
			mode: execution.mode,
			workflowId: execution.workflowId,
			data: execution.data,
			workflowData: {
				settings: execution.workflowData.settings,
				nodes: execution.workflowData.nodes,
			},
		};
	}

	/**
	 * Checks whether a user is allowed to view unredacted execution data.
	 *
	 * Uses the `execution:reveal` scope which is granted to:
	 * - Global owners and admins (via global role)
	 * - Project admins and personal project owners (via project role)
	 */
	private async canUserReveal(user: User, execution: IExecutionDb): Promise<boolean> {
		const workflow = await this.workflowFinderService.findWorkflowForUser(
			execution.workflowId,
			user,
			['execution:reveal'],
		);
		return workflow !== null;
	}

	/**
	 * Returns true when the resolved redaction policy inherently allows everyone to access
	 * unredacted data — i.e. the policy would not have redacted the execution in the first
	 * place.  The two cases are:
	 *   - policy === 'none': redaction is completely disabled.
	 *   - policy === 'non-manual' AND the execution mode is manual: manual executions are
	 *     exempt from this policy, so the data is still accessible to all.
	 */
	private policyAllowsReveal(execution: IExecutionDb): boolean {
		const policy = this.resolvePolicy(execution);
		return policy === 'none' || (policy === 'non-manual' && MANUAL_MODES.has(execution.mode));
	}

	/**
	 * Resolves the effective redaction policy for an execution.
	 *
	 * Prefers the policy captured in `runtimeData.redaction` at execution time,
	 * falls back to `workflowData.settings` for older executions, and defaults to 'none'.
	 */
	private resolvePolicy(execution: IExecutionDb): WorkflowSettings.RedactionPolicy {
		return (
			execution.data.executionData?.runtimeData?.redaction?.policy ??
			execution.workflowData.settings?.redactionPolicy ??
			'none'
		);
	}
}
