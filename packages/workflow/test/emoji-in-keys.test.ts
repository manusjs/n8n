// @vitest-environment jsdom

import { DateTime } from 'luxon';
import * as Helpers from './helpers';
import { Workflow } from '../src/workflow';

describe('Expression with emoji in keys', () => {
	describe('Template strings with emoji keys', () => {
		const nodeTypes = Helpers.NodeTypes();
		const workflow = new Workflow({
			id: '1',
			nodes: [
				{
					name: 'node',
					typeVersion: 1,
					type: 'test.set',
					id: 'uuid-1234',
					position: [0, 0],
					parameters: {},
				},
			],
			connections: {},
			active: false,
			nodeTypes,
		});
		const expression = workflow.expression;

		const evaluateWithData = (value: string, data: Record<string, unknown>) =>
			expression.getParameterValue(
				value,
				{
					$json: data,
					$binary: {},
					$itemIndex: 0,
					$input: {
						item: {
							json: data,
							binary: {},
						},
						first: () => ({ json: data, binary: {} }),
						last: () => ({ json: data, binary: {} }),
						all: () => [{ json: data, binary: {} }],
						context: {},
						params: {},
					},
					$now: DateTime.now(),
					$today: DateTime.now().startOf('day'),
					$item: (index: number, runIndex?: number) => ({
						json: data,
						binary: {},
					}),
					$items: () => [{ json: data, binary: {} }],
					$prevNode: { name: 'Start', outputIndex: 0, runIndex: 0 },
				},
				0,
				0,
				'node',
				[],
				'manual',
				{},
			);

		it('should evaluate expression with emoji in bracket notation', () => {
			const data = {
				'🚀field': 'rocket value',
				'✅status': 'completed',
				'❌error': 'failed',
			};

			expect(evaluateWithData("{{ $json['🚀field'] }}", data)).toEqual('rocket value');
			expect(evaluateWithData("{{ $json['✅status'] }}", data)).toEqual('completed');
			expect(evaluateWithData("{{ $json['❌error'] }}", data)).toEqual('failed');
		});

		it('should evaluate expression with multiple emojis in template string', () => {
			const data = {
				'🚀field': 'rocket',
				'✅status': 'done',
			};

			expect(
				evaluateWithData("Result: {{ $json['🚀field'] }} - {{ $json['✅status'] }}", data),
			).toEqual('Result: rocket - done');
		});

		it('should evaluate expression with emoji and special characters combined', () => {
			const data = {
				'🚀-field-name': 'value1',
				'✅ Status Check': 'value2',
				'emoji_🎯_middle': 'value3',
			};

			expect(evaluateWithData("{{ $json['🚀-field-name'] }}", data)).toEqual('value1');
			expect(evaluateWithData("{{ $json['✅ Status Check'] }}", data)).toEqual('value2');
			expect(evaluateWithData("{{ $json['emoji_🎯_middle'] }}", data)).toEqual('value3');
		});

		it('should evaluate JavaScript operations with emoji keys', () => {
			const data = {
				'🚀count': 10,
				'✅approved': 5,
			};

			expect(evaluateWithData("{{ $json['🚀count'] + $json['✅approved'] }}", data)).toEqual(15);
			expect(evaluateWithData("{{ $json['🚀count'] * 2 }}", data)).toEqual(20);
		});

		it('should handle nested objects with emoji keys', () => {
			const data = {
				'🚀data': {
					'✅nested': 'nested value',
				},
			};

			expect(evaluateWithData("{{ $json['🚀data']['✅nested'] }}", data)).toEqual('nested value');
		});

		it('should handle array methods with emoji keys', () => {
			const data = {
				'🚀items': [1, 2, 3, 4, 5],
			};

			expect(evaluateWithData("{{ $json['🚀items'].length }}", data)).toEqual(5);
			expect(evaluateWithData("{{ $json['🚀items'][0] }}", data)).toEqual(1);
		});

		it('should evaluate Dingbat emojis (the ones mentioned in PR 16545)', () => {
			const data = {
				'❌error': 'error message',
				'✅success': 'success message',
				'⭐rating': 5,
				'❤️likes': 100,
			};

			expect(evaluateWithData("{{ $json['❌error'] }}", data)).toEqual('error message');
			expect(evaluateWithData("{{ $json['✅success'] }}", data)).toEqual('success message');
			expect(evaluateWithData("{{ $json['⭐rating'] }}", data)).toEqual(5);
			expect(evaluateWithData("{{ $json['❤️likes'] }}", data)).toEqual(100);
		});

		it('should handle various emoji types in keys', () => {
			const data = {
				'😀smiley': 'happy',
				'👍thumbsup': 'approved',
				'🎉celebration': 'party',
				'📊chart': 'data',
				'🔥fire': 'hot',
			};

			expect(evaluateWithData("{{ $json['😀smiley'] }}", data)).toEqual('happy');
			expect(evaluateWithData("{{ $json['👍thumbsup'] }}", data)).toEqual('approved');
			expect(evaluateWithData("{{ $json['🎉celebration'] }}", data)).toEqual('party');
			expect(evaluateWithData("{{ $json['📊chart'] }}", data)).toEqual('data');
			expect(evaluateWithData("{{ $json['🔥fire'] }}", data)).toEqual('hot');
		});

		it('should work with emoji at different positions in key name', () => {
			const data = {
				'🚀start': 'value1',
				'middle🎯emoji': 'value2',
				'end🔚': 'value3',
			};

			expect(evaluateWithData("{{ $json['🚀start'] }}", data)).toEqual('value1');
			expect(evaluateWithData("{{ $json['middle🎯emoji'] }}", data)).toEqual('value2');
			expect(evaluateWithData("{{ $json['end🔚'] }}", data)).toEqual('value3');
		});
	});
});
