import { Logger } from '@n8n/backend-common';
import { mockInstance } from '@n8n/backend-test-utils';
import type { IExecutionDb, User } from '@n8n/db';
import type { ExecutionStatus, IRunExecutionData, WorkflowExecuteMode } from 'n8n-workflow';

import { ForbiddenError } from '@/errors/response-errors/forbidden.error';
import { WorkflowFinderService } from '@/workflows/workflow-finder.service';

import { ExecutionRedactionService } from '../execution-redaction.service';
import { FullItemRedactionStrategy } from '../strategies/full-item-redaction.strategy';
import { NodeDefinedFieldRedactionStrategy } from '../strategies/node-defined-field-redaction.strategy';

describe('ExecutionRedactionService', () => {
	const logger = mockInstance(Logger);
	const workflowFinderService = mockInstance(WorkflowFinderService);
	const fullItemRedactionStrategy = mockInstance(FullItemRedactionStrategy);
	const nodeDefinedFieldRedactionStrategy = mockInstance(NodeDefinedFieldRedactionStrategy);

	let service: ExecutionRedactionService;

	const mockUser = {
		id: 'user-123',
		email: 'test@example.com',
		firstName: 'Test',
		lastName: 'User',
		role: 'global:owner',
	} as unknown as User;

	beforeEach(() => {
		jest.clearAllMocks();
		service = new ExecutionRedactionService(
			logger,
			workflowFinderService,
			fullItemRedactionStrategy,
			nodeDefinedFieldRedactionStrategy,
		);
		// Default: user lacks execution:reveal scope
		workflowFinderService.findWorkflowForUser.mockResolvedValue(null);
		fullItemRedactionStrategy.apply.mockResolvedValue(undefined);
		nodeDefinedFieldRedactionStrategy.apply.mockResolvedValue(undefined);
	});

	const makeExecution = (
		overrides: {
			mode?: WorkflowExecuteMode;
			policy?: 'none' | 'all' | 'non-manual';
			workflowSettingsPolicy?: 'none' | 'all' | 'non-manual';
			withRuntimeData?: boolean;
		} = {},
	): IExecutionDb => {
		const { mode = 'manual', policy, workflowSettingsPolicy, withRuntimeData = true } = overrides;

		const executionData: IRunExecutionData['executionData'] = {
			contextData: {},
			nodeExecutionStack: [],
			metadata: {},
			waitingExecution: {},
			waitingExecutionSource: null,
		};

		if (withRuntimeData && policy !== undefined) {
			executionData.runtimeData = {
				version: 1 as const,
				establishedAt: Date.now(),
				source: mode,
				redaction: { version: 1 as const, policy },
			};
		}

		// @ts-expect-error - Partial mock data for testing
		return {
			id: 'execution-123',
			mode,
			createdAt: new Date('2024-01-01'),
			startedAt: new Date('2024-01-01'),
			stoppedAt: new Date('2024-01-01'),
			workflowId: 'workflow-123',
			finished: true,
			retryOf: undefined,
			retrySuccessId: undefined,
			status: 'success' as ExecutionStatus,
			waitTill: null,
			storedAt: 'db',
			data: {
				version: 1,
				resultData: { runData: {} },
				executionData,
			},
			workflowData: {
				id: 'workflow-123',
				name: 'Test Workflow',
				active: false,
				isArchived: false,
				createdAt: new Date('2024-01-01'),
				updatedAt: new Date('2024-01-01'),
				nodes: [],
				connections: {},
				settings: workflowSettingsPolicy ? { redactionPolicy: workflowSettingsPolicy } : {},
				staticData: {},
				activeVersionId: null,
			},
		} as IExecutionDb;
	};

	describe('FullItemRedactionStrategy inclusion', () => {
		it('is included when redactExecutionData === true (regardless of policy)', async () => {
			const execution = makeExecution({ policy: 'none', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser, redactExecutionData: true });
			expect(fullItemRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is included when policy is "all" and mode is manual', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'manual' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is included when policy is "all" and mode is trigger', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is included when policy is "non-manual" and mode is trigger', async () => {
			const execution = makeExecution({ policy: 'non-manual', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is included when policy is "non-manual" and mode is webhook', async () => {
			const execution = makeExecution({ policy: 'non-manual', mode: 'webhook' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is NOT included when policy is "none"', async () => {
			const execution = makeExecution({ policy: 'none', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).not.toHaveBeenCalled();
		});

		it('is NOT included when policy is "non-manual" and mode is manual', async () => {
			const execution = makeExecution({ policy: 'non-manual', mode: 'manual' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).not.toHaveBeenCalled();
		});

		it('is NOT included on reveal path (redactExecutionData === false)', async () => {
			workflowFinderService.findWorkflowForUser.mockResolvedValue({ id: 'workflow-123' } as never);
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser, redactExecutionData: false });
			expect(fullItemRedactionStrategy.apply).not.toHaveBeenCalled();
		});
	});

	describe('NodeDefinedFieldRedactionStrategy inclusion', () => {
		it('is always included when redacting', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(nodeDefinedFieldRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is included even when policy is "none" (no item clearing)', async () => {
			const execution = makeExecution({ policy: 'none', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(nodeDefinedFieldRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('is included on reveal path (redactExecutionData === false)', async () => {
			workflowFinderService.findWorkflowForUser.mockResolvedValue({ id: 'workflow-123' } as never);
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser, redactExecutionData: false });
			expect(nodeDefinedFieldRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});
	});

	describe('strategy ordering', () => {
		it('runs FullItemRedactionStrategy before NodeDefinedFieldRedactionStrategy', async () => {
			const callOrder: string[] = [];
			fullItemRedactionStrategy.apply.mockImplementation(async () => {
				callOrder.push('full');
			});
			nodeDefinedFieldRedactionStrategy.apply.mockImplementation(async () => {
				callOrder.push('node-defined');
			});

			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });

			expect(callOrder).toEqual(['full', 'node-defined']);
		});
	});

	describe('context passed to strategies', () => {
		it('passes redactExecutionData from options', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser, redactExecutionData: true });

			const [, context] = fullItemRedactionStrategy.apply.mock.calls[0];
			expect(context.redactExecutionData).toBe(true);
		});

		it('passes userCanReveal: true when user has permission', async () => {
			workflowFinderService.findWorkflowForUser.mockResolvedValue({ id: 'workflow-123' } as never);
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });

			const [, context] = fullItemRedactionStrategy.apply.mock.calls[0];
			expect(context.userCanReveal).toBe(true);
		});

		it('passes userCanReveal: false when user lacks permission', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });

			const [, context] = fullItemRedactionStrategy.apply.mock.calls[0];
			expect(context.userCanReveal).toBe(false);
		});

		it('passes userCanReveal: true when policyAllowsReveal (policy=none)', async () => {
			const execution = makeExecution({ policy: 'none', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });

			const [, context] = nodeDefinedFieldRedactionStrategy.apply.mock.calls[0];
			expect(context.userCanReveal).toBe(true);
		});

		it('passes userCanReveal: true when policyAllowsReveal (policy=non-manual, mode=manual)', async () => {
			const execution = makeExecution({ policy: 'non-manual', mode: 'manual' });
			await service.processExecution(execution, { user: mockUser });

			const [, context] = nodeDefinedFieldRedactionStrategy.apply.mock.calls[0];
			expect(context.userCanReveal).toBe(true);
		});
	});

	describe('reveal path (redactExecutionData === false)', () => {
		it('throws ForbiddenError when neither policy nor user allows reveal', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await expect(
				service.processExecution(execution, { user: mockUser, redactExecutionData: false }),
			).rejects.toThrow(ForbiddenError);
		});

		it('does not throw when policy allows reveal (policy=none)', async () => {
			const execution = makeExecution({ policy: 'none', mode: 'trigger' });
			await expect(
				service.processExecution(execution, { user: mockUser, redactExecutionData: false }),
			).resolves.toBeDefined();
		});

		it('does not throw when policy allows reveal (policy=non-manual, mode=manual)', async () => {
			const execution = makeExecution({ policy: 'non-manual', mode: 'manual' });
			await expect(
				service.processExecution(execution, { user: mockUser, redactExecutionData: false }),
			).resolves.toBeDefined();
		});

		it('does not throw when user has reveal permission', async () => {
			workflowFinderService.findWorkflowForUser.mockResolvedValue({ id: 'workflow-123' } as never);
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await expect(
				service.processExecution(execution, { user: mockUser, redactExecutionData: false }),
			).resolves.toBeDefined();
		});
	});

	describe('DB call optimisation', () => {
		it('does not call findWorkflowForUser when policyAllowsReveal (policy=none)', async () => {
			const execution = makeExecution({ policy: 'none', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(workflowFinderService.findWorkflowForUser).not.toHaveBeenCalled();
		});

		it('does not call findWorkflowForUser when policyAllowsReveal (policy=non-manual, mode=manual)', async () => {
			const execution = makeExecution({ policy: 'non-manual', mode: 'manual' });
			await service.processExecution(execution, { user: mockUser });
			expect(workflowFinderService.findWorkflowForUser).not.toHaveBeenCalled();
		});

		it('calls findWorkflowForUser once when policy does not inherently allow reveal', async () => {
			const execution = makeExecution({ policy: 'all', mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(workflowFinderService.findWorkflowForUser).toHaveBeenCalledTimes(1);
			expect(workflowFinderService.findWorkflowForUser).toHaveBeenCalledWith(
				'workflow-123',
				mockUser,
				['execution:reveal'],
			);
		});
	});

	describe('policy resolution precedence', () => {
		it('prefers runtimeData policy over workflow settings (runtime=none overrides settings=all)', async () => {
			const execution = makeExecution({
				policy: 'none',
				workflowSettingsPolicy: 'all',
				mode: 'trigger',
			});
			await service.processExecution(execution, { user: mockUser });
			// runtimeData policy=none → no item clearing despite workflow settings=all
			expect(fullItemRedactionStrategy.apply).not.toHaveBeenCalled();
		});

		it('falls back to workflow settings when runtimeData is missing', async () => {
			const execution = makeExecution({
				withRuntimeData: false,
				workflowSettingsPolicy: 'all',
				mode: 'trigger',
			});
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).toHaveBeenCalledTimes(1);
		});

		it('defaults to none when both runtimeData and workflow settings are missing', async () => {
			const execution = makeExecution({ withRuntimeData: false, mode: 'trigger' });
			await service.processExecution(execution, { user: mockUser });
			expect(fullItemRedactionStrategy.apply).not.toHaveBeenCalled();
		});
	});
});
