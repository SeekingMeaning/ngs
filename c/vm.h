#ifndef VM_H
#define VM_H
#include <utarray.h>
#include <uthash.h>
#include "ngs.h"
#include "obj.h"

#define NGS_UNUSED __attribute__((unused))

#define MAX_STACK     (1024)
#define MAX_FRAMES      (64)
typedef uint16_t PATCH_OFFSET;
typedef int16_t JUMP_OFFSET;

typedef int IP;

typedef struct var_index {
	char *name;
	GLOBAL_VAR_INDEX index;
	UT_hash_handle hh;
} VAR_INDEX;

// WIP
typedef struct interned_string {
	char *str;
	UT_hash_handle hh;
} INTERNED_STRING;

typedef struct frame {
	IP prev_ip;
	size_t prev_stack_ptr;
	// TODO: smarter allocation of locals when can't be captured by clousre,
	//       probably on stack.
	VALUE *locals;
	VALUE closure;
	// int n_local_vars; // needed
} FRAME;

// Plan: have exactly one context per thread.
typedef struct context {
	VALUE stack[MAX_STACK];
	size_t stack_ptr;

	FRAME frames[MAX_FRAMES];
	size_t frame_ptr;
} CTX;

typedef struct vm_struct {
	char *bytecode;
	size_t bytecode_len;
	VALUE *globals;
	size_t globals_len;
	VAR_INDEX *globals_indexes;
	char **globals_names;

	NGS_TYPE *Null;
	NGS_TYPE *Bool;
	NGS_TYPE *Int;
	NGS_TYPE *Str;
	NGS_TYPE *Arr;
	NGS_TYPE *Fun;
	NGS_TYPE *Any;
	NGS_TYPE *Seq;
	NGS_TYPE *Type;
	NGS_TYPE *Hash;
	NGS_TYPE *CLib;
	NGS_TYPE *CSym;
} VM;

enum opcodes {
	OP_HALT,
	OP_PUSH_NULL,
	OP_PUSH_FALSE,
	OP_PUSH_TRUE,
	OP_PUSH_UNDEF,
	OP_PUSH_INT,
	OP_PUSH_L_STR,
	OP_DUP,
	OP_POP,
	OP_RESOLVE_GLOBAL,
	OP_PATCH,
	OP_INIT_DONE,
	OP_FETCH_GLOBAL,
	OP_STORE_GLOBAL,
	OP_FETCH_LOCAL,
	OP_STORE_LOCAL,
	OP_CALL,
	OP_RET,
	OP_JMP,
	OP_JMP_TRUE,
	OP_JMP_FALSE,
	OP_MAKE_ARR,
	OP_MAKE_CLOSURE,
	OP_TO_STR,
	OP_MAKE_STR,
	OP_PUSH_EMPTY_STR,
	OP_GLOBAL_DEF_P,
	OP_LOCAL_DEF_P,
	OP_DEF_GLOBAL_FUNC,
	OP_DEF_LOCAL_FUNC,
	OP_FETCH_UPVAR,
	OP_STORE_UPVAR,
	OP_UPVAR_DEF_P,
	OP_DEF_UPVAR_FUNC,
	OP_MAKE_HASH,
	OP_TO_BOOL,
	NUMBER_OF_OPCODES,
};

extern char *opcodes_names[NUMBER_OF_OPCODES];

typedef enum method_result_enum {
	METHOD_OK,
	METHOD_ARGS_MISMATCH,
	METHOD_IMPL_MISSING,
	METHOD_EXCEPTION_OCCURED,
} METHOD_RESULT;

typedef METHOD_RESULT (*VM_FUNC)(const VALUE *argv, VALUE *result);
typedef METHOD_RESULT (*VM_EXT_FUNC)(VM *vm, CTX *ctx, const VALUE *argv, VALUE *result);
void vm_init(VM *vm, int argc, char **argv);
size_t vm_load_bytecode(VM *vm, char *bc, size_t len);
void ctx_init(CTX *ctx);
GLOBAL_VAR_INDEX check_global_index(VM *vm, const char *name, size_t name_len, int *found);
GLOBAL_VAR_INDEX get_global_index(VM *vm, const char *name, size_t name_len);

static const UT_icd ut_value_icd _UNUSED_ = {sizeof(VALUE),NULL,NULL,NULL};
// typedef int VM_INT;
METHOD_RESULT vm_run(VM *vm, CTX *ctx, IP ip, VALUE *result);
#endif
