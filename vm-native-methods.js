"use strict";

var fs = require('fs');
var tty = require('tty');
var child_process = require('child_process');
var util = require('util');

var _ = require('underscore');

var data = require('./vm-data');
var compile = require('./compile');

function to_ngs_object(v) {
	if(_.isNull(v)) {
		return NgsValue('Null', null);
	}
	if(_.isBoolean(v)) {
		return NgsValue('Bool', v);
	}
	if(_.isNumber(v)) {
		return NgsValue('Number', v);
	}
	if(_.isString(v)) {
		return NgsValue('String', v);
	}
	if(_.isArray(v)) {
		return NgsValue('Array', v.map(to_ngs_object));
	}
	if(_.isObject(v)) {
		var h = {}
		_.keys(v).forEach(function(k) {
			h[k] = to_ngs_object(v[k]);
		});
		return NgsValue('Hash', h);
	}
	throw new Error("to_ngs_object() failed for " + v);
}

function Args() {
	if(!this || this == global) {
		return new Args();
	}
	this.args = [];
};


Args.prototype.general = function(name, typ, arg_type) {
	this.args.push(
		NgsValue(
			'Array',
			[
				NgsValue('String', name),
				NgsValue('String', arg_type),
				NgsValue(typ ? 'String' : 'Null', typ)
			]
		)
	);
	return this;
}
Args.prototype.pos = function(name, typ) {
	return this.general(name, typ, 'arg_pos')
}
Args.prototype.rest_pos = function(name) {
	return this.general(name, 'Array' /* not used */, 'arg_rest_pos')
}
Args.prototype.named = function(name, typ) {
	return this.general(name, typ, 'arg_nam')
}
Args.prototype.get = function() {
	return NgsValue('Array', this.args);
}

function p_args() {
	var ret = Args();
	for(var i=0; i<arguments.length; i+= 2) {
		ret.pos(arguments[i], arguments[i+1]);
	}
	return ret.get();
}

function register_native_methods() {
	// Expecting:
	// this - Context object

	this.registerNativeMethod('Array', p_args(), function vm_Array() {
		return NgsValue('Array', new Array());
	});

	this.registerNativeMethod('Hash', p_args(), function vm_Array() {
		return NgsValue('Hash', new Object());
	});

	this.registerNativeMethod('Bool', p_args('x', null), function vm_Bool_p_any(scope) {
		// Anything that was not processed by any other Bool() method
		// will have it's JS boolean value as result.
		return NgsValue('Bool', !!scope.x.data); // XXX broken get_TYP(v) data access abstraction
	});

	this.registerNativeMethod('Bool', p_args('p', 'Process'), function vm_Bool_p_process(scope) {
		var p = get_prc(scope.p);
		if(p.state !== 'done') {
			// TODO: throw GuardYield or something like that,
			//		 indicating guard failure
			throw new Error("Can't Bool() unfinished process");
		}
		// exit_code can be null if process was terminated by a signal
		return NgsValue('Bool', p.exit_code === 0);
	});

	this.registerNativeMethod('push', p_args('a', 'Array', 'x', null), function vm_push(scope) {
		var a = get_arr(scope.a);
		a.push(scope.x);
		return scope.a;
	});

	this.registerNativeMethod('__add', p_args('a', 'Number', 'b', 'Number'), function vm___add_p_num_num(scope) {
		return NgsValue('Number', get_num(scope.a) + get_num(scope.b));
	});

	this.registerNativeMethod('__add', p_args('a', 'String', 'b', 'String'), function vm___add_p_str_str(scope) {
		return NgsValue('String', get_str(scope.a) + get_str(scope.b));
	});

	this.registerNativeMethod('__add', p_args('a', 'Array', 'b', 'Array'), function vm___add_p_arr_arr(scope) {
		return NgsValue('Array', get_arr(scope.a).concat(get_arr(scope.b)));
	});

	this.registerNativeMethod('__sub', p_args('a', 'Number', 'b', 'Number'), function vm___sub(scope) {
		return NgsValue('Number', get_num(scope.a) - get_num(scope.b));
	});

	this.registerNativeMethod('__mul', p_args('a', 'Number', 'b', 'Number'), function vm___sub(scope) {
		return NgsValue('Number', get_num(scope.a) * get_num(scope.b));
	});

	this.registerNativeMethod('__lt', p_args('a', 'Number', 'b', 'Number'), function vm___lt(scope) {
		return NgsValue('Bool', get_num(scope.a) < get_num(scope.b));
	});
	this.registerNativeMethod('__gt', p_args('a', 'Number', 'b', 'Number'), function vm___gt(scope) {
		return NgsValue('Bool', get_num(scope.a) > get_num(scope.b));
	});

	this.registerNativeMethod('__eq', p_args('a', null, 'b', null), function vm___eq(scope) {
		return NgsValue('Bool', scope.a.eq(scope.b));
	});

	this.registerNativeMethod('__set_item', p_args('a', 'Array', 'idx', 'Number', 'v', null), function vm___set_item_p_arr_num_any(scope) {
		var a = get_arr(scope.a);
		var i = get_num(scope.idx)
		// TODO: assert i is integer
		if(a.length < i) {
			for(var j=a.length;j<i;j++) {
				a[j] = NgsValue('Null', null);
			}
		}
		a[i] = scope.v;
		return scope.v;
	});

	this.registerNativeMethod('keys', p_args('h', 'Hash'), function vm_keys_p_hsh(scope) {
		var h = get_hsh(scope.h);
		return to_ngs_object(_.keys(h));
	});

	this.registerNativeMethod('__set_item', p_args('h', 'Hash', 'k', 'String', 'v', null), function vm___set_item_p_hsh_str_any(scope) {
		var h = get_hsh(scope.h);
		var k = get_str(scope.k)
		h[k] = scope.v;
		return scope.v;
	});

	this.registerNativeMethod('__get_item', p_args('a', 'Array', 'idx', 'Number'), function vm___get_item_p_arr_num(scope) {
		var a = get_arr(scope.a);
		var i = get_num(scope.idx)
		// TODO: assert i is integer
		if(i<0 || i>a.length-1) {
			throw new Error("Accessing out of bounds. Array: " + a + ". Index: " + i);
		}
		return a[i];
	});

	this.registerNativeMethod('__get_item', p_args('s', 'String', 'idx', 'Number'), function vm___get_item_p_str_num(scope) {
		var s = get_str(scope.s);
		var i = get_num(scope.idx)
		// TODO: assert i is integer
		if(i<0 || i>s.length-1) {
			throw new Error("Accessing out of bounds. Array: " + a + ". Index: " + i);
		}
		return NgsValue('String', s[i]);
	});

	this.registerNativeMethod('len', p_args('a', 'Array'), function vm_len_p_arr(scope) {
		return NgsValue('Number', get_arr(scope.a).length);
	});

	this.registerNativeMethod('len', p_args('s', 'String'), function vm_len_p_str(scope) {
		return NgsValue('Number', get_str(scope.s).length);
	});

	this.registerNativeMethod('len', p_args('h', 'Hash'), function vm_len_p_hsh(scope) {
		return NgsValue('Number', _.size(get_hsh(scope.h)));
	});

	this.registerNativeMethod('echo', p_args('s', 'String'), function vm_echo(scope) {
		// console.log('ECHO', util.inspect(get_arr(scope.p), {depth: 20}), scope.n);
		console.log(get_str(scope.s));
		return scope.s;
	});

	this.registerNativeMethod('write', p_args('s', 'String'), function vm_echo(scope) {
		// console.log('ECHO', util.inspect(get_arr(scope.p), {depth: 20}), scope.n);
		process.stdout.write(get_str(scope.s));
		return scope.s;
	});

	this.registerNativeMethod('__get_lexical_scopes', p_args(), function vm___get_lexical_scopes() {
		// Need lexical scopes of caller, not ours.
		// Dirty scopes hack
		return NgsValue('Scopes', this.getCallerLexicalScopes());
	});

	this.registerNativeMethod('__lambda', p_args('scopes', 'Scopes', 'args', 'Array', 'ip', 'Number', 'name', 'String'), function vm___lambda(scope) {
		return NgsValue('Lambda', {scopes: scope.scopes, args: scope.args, code_ptr: scope.ip, name: scope.name});
	});

	this.registerNativeMethod('__register_method', p_args('lambda', 'Lambda', 'name', 'String', 'global', 'Bool'), function vm___register_method(scope) {
		var name = get_str(scope.name);
		// The method is created in _caller_ lexical scops, not in ours.
		// Dirty lexical_scopes hack start
		var t = this.frame.scopes;
		this.frame.scopes = this.getCallerLexicalScopes();
		this.registerMethod(name, scope.lambda, get_boo(scope.global));
		this.frame.scopes = t;
		// Dirty lexical_scopes hack end
		return scope.lambda;
	});

	this.registerNativeMethod('__throw', p_args('e', null), function vm___throw(scope, vm) {
		this.throw_(scope.e, vm);
		return NgsValue('Null', null);
	});

	this.registerNativeMethod('native_spawn', Args().rest_pos('args').get(), function ngs_runtime_spawn(scope, v) {
		var args = get_arr(scope.args);
		var props = {
			'cmd': get_str(args[0]),
			'state': 'running',
			'args': args.slice(1).map(get_str),
			'error': null,
			'exit_code': null,
			'signal': null,
			'stdout': '',
			'stderr': '',
			'threads_waiting': [],
			'_finish_events': 2 // want both exit and close events
		};
		var ngs_runtime_spawn_finish_callback = function(force) {
			if(!props._finish_events) {
				// already finished
				return;
			}
			props._finish_events--;
			if(force) {
				props._finish_events = 0;
			}
			if(!props._finish_events) {
				props.state = 'done';
				props.threads_waiting.forEach(function(ctx) {
					v.unsuspend_context(ctx);
				});
			}
		}.bind(this);
		// console.log('start_external()', props);
		// TODO: process working directory should be
		//		 inherited from parent process.
		// TODO: XXX cwd must be flexible, not process.cwd
		var p = child_process.spawn(props.cmd, props.args, {
			cwd: process.cwd()
		});
		// TODO: maybe store output with it's timestamp?
		(['stdout', 'stderr']).forEach(function(output_channel_name) {
			p[output_channel_name].on('data', function ngs_runtime_spawn_on_data(data) {
				// console.log('DATA', data);
				props[output_channel_name] += data;
			});
		});
		p.on('error', function(e) {
			props.error = e;
			ngs_runtime_spawn_finish_callback(true);
		});
		p.on('exit', function(exit_code, signal) {
			props.exit_code = exit_code;
			props.signal = signal;
			ngs_runtime_spawn_finish_callback();
		});
		p.on('close', ngs_runtime_spawn_finish_callback);

		return NgsValue('Process', props);
	});
	this.registerNativeMethod('wait', p_args('p', 'Process'), function vm___get_attr(scope, v) {
		// TODO (maybe): store all fields as NGS objects in the first place
		var p = get_prc(scope.p);
		if(p.state === 'done') {
			return scope.p;
		}
		v.suspend_context();
		p.threads_waiting.push(this);
		return scope.p;
	})
	this.registerNativeMethod('__get_attr', p_args('p', 'Process', 'attr', null), function vm___get_attr(scope) {
		// TODO (maybe): store all fields as NGS objects in the first place
		var a = get_str(scope.attr);
		var p = get_prc(scope.p);
		if(!_.has(p, a)) {
			throw new Error("Process object does not have attribute " + a);
		}
		return to_ngs_object(p[a]);
	})
	this.registerNativeMethod('__get_item', p_args('h', 'Hash', 'attr', 'String'), function vm___get_attr(scope) {
		// TODO (maybe): store all fields as NGS objects in the first place
		var a = get_str(scope.attr);
		var h = get_hsh(scope.h);
		if(!_.has(h, a)) {
			throw new Error("Hash does not have attribute " + a);
		}
		return h[a];
	})
	this.registerNativeMethod('__set_attr', p_args('h', 'Hash', 'attr', 'String', 'v', null), function vm___set_attr(scope) {
		// TODO (maybe): store all fields as NGS objects in the first place
		var a = get_str(scope.attr);
		var h = get_hsh(scope.h);
		h[a] = scope.v;
		return scope.h;
	})
	this.registerNativeMethod('from_json', p_args('s', 'String'), function vm_from_json(scope) {
		var json;
		var ret;
		json = get_str(scope.s);
		try {
			ret = JSON.parse(json);
		} catch(e) {
			this.thr(to_ngs_object(['runtime', 'failed to parse JSON']));
			return;
		}
		return to_ngs_object(ret);
	})
	this.registerNativeMethod('fetch_file', p_args('f', 'String'), function vm_read(scope) {
		// TODO: handle encoding later
		return NgsValue('String', fs.readFileSync(get_str(scope.f), {encoding: 'UTF-8'}));
	})
	this.registerNativeMethod('__match', p_args('s', 'String', 'regex', 'String'), function vm___tilde(scope) {
		var r = new RegExp(get_str(scope.regex));
		return to_ngs_object(get_str(scope.s).match(r));
	})
	this.registerNativeMethod('sort', p_args('a', 'Array'), function vm_sort(scope) {
		var a = get_arr(scope.a);
		a.sort();
		return NgsValue('Array', a);
	});
	this.registerNativeMethod('uniq', p_args('a', 'Array'), function vm_uniq(scope) {
		var a = get_arr(scope.a);
		return NgsValue('Array', _.uniq(a, false, function(elt) {return elt[1]}));
	});

	// stdin, stdout, ...
	['stdin', 'stdout', 'stderr'].forEach(function(s) {
		this.set_var(s, NgsValue('Stream', s));
	}.bind(this))
	this.registerNativeMethod('istty', p_args('s', 'Stream'), function vm_istty(scope) {
		var s = get_stm(scope.s);
		return NgsValue('Bool', s.isTTY);
	});
	this.registerNativeMethod('Readline', p_args(), function vm_readline(scope) {
		var readline = require('readline');
		var rl = readline.createInterface(process.stdin, process.stdout);
		return NgsValue('Readline', rl);
	});
	this.registerNativeMethod('read', p_args('rl', 'Readline', 'prompt', 'String'), function vm_read_p_readline(scope, v) {
		var rl = get_rl(scope.rl);
		var ctx = this;
		function line_handler(line) {
			ctx.stack.pop();
			ctx.stack.push(NgsValue('String', line));
			v.unsuspend_context(ctx);
			rl.removeListener('line', line_handler);
		}
		rl.on('line', line_handler);
		v.suspend_context(this);
		rl.setPrompt(get_str(scope.prompt));
		rl.prompt();
		return NgsValue('String', 'READLINE-TO-BE-READ');
	});
	this.registerNativeMethod('close', p_args('rl', 'Readline'), function vm_close_p_readline(scope, v) {
		var rl = get_rl(scope.rl);
		rl.close();
		return NgsValue('Null', null);
	});
	this.registerNativeMethod('compile', p_args('s', 'String'), function vm_compile_p_str(scope, v) {
		var s = get_str(scope.s);
		var out;
		try {
			out = compile.compile(s, {leave_value_in_stack: true});
			return NgsValue('Code', out.compiled_code);
		} catch(e) {
			this.thr(to_ngs_object(['compile', e.toString()]));
		}
	});
	this.registerNativeMethod('load', p_args('c', 'Code'), function vm_load_p_cod(scope, v) {
		// TODO: handle scopes correcty
		var c = get_cod(scope.c);
		var ptr = v.useCodeWithRet(c);
		var m = NgsValue('Lambda', {
			scopes: NgsValue('Scopes', this.frame.scopes.slice(0, this.frame.scopes.length-1)),
			args: p_args(),
			code_ptr: to_ngs_object(ptr),
			name: 'loaded_code',
		});

		return m;
	});
	this.registerNativeMethod('String', p_args('n', 'Number'), function vm_string_p_num(scope, v) {
		return to_ngs_object(get_num(scope.n).toString());
	});
	this.registerNativeMethod('typeof', p_args('x', null), function vm_typeof_p_any(scope, v) {
		return to_ngs_object(get_type(scope.x));
	});
	// Not very elegant solution :/
	// Injects additional scope and marks it as target for set_var instead of the deepest scope.
	// Allows saving variables between code calls in CLI:
	//   code = compile(l)
	//   ...
	//   lambda_ = load(code[1]).locals(local_scope)
	this.registerNativeMethod('locals', p_args('l', 'Lambda', 'h', 'Hash'), function vm_locals_p_lmb_hsh(scope, v) {
		var lambda = get_lmb(scope.l);
		var locals = get_hsh(scope.h);
		return NgsValue('Lambda', {
			scopes: NgsValue('Scopes', scope.l.data.scopes.data.concat(locals, true)),
			args: lambda.args,
			code_ptr: lambda.code_ptr,
			name: lambda.name + '_with_locals'
		});
	});
	this.registerNativeMethod('globals', p_args(), function vm_globals(scope, v) {
		var scopes = this.getCallerLexicalScopes();
		return NgsValue('Hash', scopes[0]);
	});
	this.registerNativeMethod('meta', p_args('x', null), function vm_meta(scope, v) {
		// to_ngs_object() can not handle it properly
		return NgsValue('Hash', data.get_meta(scope.x));
	});
	this.registerNativeMethod('thread', p_args(), function vm_thread(scope, v) {
		return NgsValue('Thread', this);
	});
	this.registerNativeMethod('thread', p_args('f', 'Lambda'), function vm_thread_p_lmb(scope, v) {
		var ctx = v.setupContext();
		ctx.frame.ip = 'context_finished';
		ctx.invoke_or_throw(scope.f, to_ngs_object([]), to_ngs_object({}), v, true);
		return NgsValue('Thread', ctx);
	});
	this.registerNativeMethod('String', p_args('t', 'Thread'), function vm_string_p_thread(scope) {
		var t = get_thr(scope.t);
		return NgsValue('String', "<Thread " + t.id.toString() + ":" + t.state + ">");
	});
	this.registerNativeMethod('__get_attr', p_args('t', 'Thread', 'k', 'String'), function vm___get_attr_p_thr(scope) {
		var attrs = ['id', 'state', 'cycles'];
		var t = get_thr(scope.t);
		var k = get_str(scope.k);
		if(!_.contains(attrs, k)) {
			this.thr(["programming", "Thread does not have attribute " + k]);
			return;
		}
		return to_ngs_object(t[k]);
	});
	this.registerNativeMethod('wait', p_args('t', 'Thread'), function vm_wait_p_thread(scope, v) {
		this.wait(get_thr(scope.t), v);
		return scope.t;
	});
	this.registerNativeMethod('locals', p_args('t', 'Thread'), function vm_locals_p_thread(scope) {
		return NgsValue('Hash', get_thr(scope.t).thread_locals);
	});
	this.registerNativeMethod('kill', p_args('t', 'Thread'), function vm_kill_p_thread(scope) {
		// Not functional yet
		get_thr(scope.t).finish_context();
		return scope.t;
	});
	this.registerNativeMethod('lines', p_args('s', 'String'), function vm_lines_p_str(scope) {
		// TODO: make non-naive implementation in stdlib instead of this
		return to_ngs_object(get_str(scope.s).split("\n"));
	});
	this.registerNativeMethod('id', p_args('x', null), function vm_id_p_any(scope) {
		return to_ngs_object(get_id(scope.x));
	});
	this.registerNativeMethod('obj', p_args('type', 'String'), function vm_obj_p_str(scope) {
		return NgsValue(get_str(scope.type), {});
	});
	this.registerNativeMethod('init', p_args('n', 'Number'), function vm_init_p_num(scope) {
		scope.n.data = 0;
		return scope.n;
	});
	this.registerNativeMethod('init', p_args('a', 'Array'), function vm_init_p_arr(scope) {
		scope.a.data = [];
		return scope.a;
	});
	this.registerNativeMethod('init', p_args('h', 'Hash'), function vm_init_p_hsh(scope) {
		scope.h.data = {};
		return scope.h;
	});
	this.set_var('__TYPES', to_ngs_object({}));
}

exports.Args = Args.bind(null);
exports.register_native_methods = register_native_methods;
exports.to_ngs_object = to_ngs_object;
