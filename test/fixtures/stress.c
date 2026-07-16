/*
 * stress.c — adversarial parser fixture for Code Translator.
 * Companion to sample.c (the happy path). This file targets predicted
 * failure areas. Annotation is always on the line ABOVE the test line
 * (trailing comments are themselves a trap — see below):
 *
 *   EXPECT: <kind>  what the panel should show
 *   GAP:            valid C the parser can't handle yet → MUST say "unknown"
 *   TRAP:           line the parser currently gets WRONG (misparse — worse
 *                   than unknown). These are the bugs to fix first.
 *
 * Compiles as real C: gcc -w -c stress.c
 */

// EXPECT: preprocessor ifndef, name STRESS_C
#ifndef STRESS_C
// EXPECT: preprocessor define, no value
#define STRESS_C

// EXPECT: preprocessor include, system header
#include <stdio.h>
// EXPECT: preprocessor include, system header
#include <stdlib.h>
// EXPECT: preprocessor define, object-like, value 42
#define MAX_ITER 42
// EXPECT: preprocessor define, function-like, one param x
#define ABS(x) ((x) < 0 ? -(x) : (x))
// GAP: #pragma is an unrecognized directive → unknown
#pragma GCC diagnostic ignored "-Wunused-value"

// EXPECT: block_open, typedef struct, tag s_point (Allman brace)
typedef struct s_point
// GAP: bare '{' on its own line → unknown
{
	// EXPECT: variable_decl, int x
	int	x;
	// EXPECT: variable_decl, int y
	int	y;
// EXPECT: block_close, name t_point
}	t_point;

// FIXED (was TRAP): pointer return type — funcDef used to capture the '*'
// then discard it, reporting return type "char". Now captured as returnPointer.
// EXPECT: function_def, pointer return type char* correctly captured
char	*get_name(void)
{
	// EXPECT: variable_decl, char pointer, value "sample"
	char	*name = "sample";
	// EXPECT: control_flow return, 42-style parens
	return (name);
}

// Signature variants — hidden from the compiler, cursor-testable:
#ifdef PARSER_TEST_ONLY
// EXPECT: function_def — valid array-of-pointers param, name "argv[]"
int	main(int argc, char *argv[])
// EXPECT: unknown — 'char argv[][]' is INVALID C ([][] has no inner size).
// Was a TRAP: parser used to explain it as a normal main. Fixed by
// param validation in parseParams — malformed params reject the match.
int	main(int argc, char argv[][])
#endif
// EXPECT: function_def — int main, params: int argc, char **argv (double ptr)
int	main(int argc, char **argv)
{
	// EXPECT: variable_decl, int i, value 0
	int	i = 0;
	// EXPECT: variable_decl, pointer, no value
	int	*ptr;
	// EXPECT: variable_decl, array size 10
	int	arr[10];
	// EXPECT: variable_decl — size-inferred array, string initializer
	char	small[] = "hi";
	// EXPECT: variable_decl — value is a string containing ';' and '='
	char	*msg = "a=b; still one string";
	// EXPECT: variable_decl, 42-style type t_point
	t_point	pt;
	// EXPECT: variable_decl — cast + call in the initializer
	t_point	*pp = (t_point *)malloc(sizeof(t_point));
	// FIXED (was TRAP): 2D array — arraySize used to be captured as "2][2".
	// GAP: 2D arrays aren't supported (see KNOWN_GAPS.md) → unknown
	int	grid[2][2];

	/* ---- assignments ---- */
	// EXPECT: assignment, plain =
	i = 5;
	// EXPECT: assignment, compound +=
	i += 2;
	// EXPECT: assignment, compound <<= (must NOT be misread as comparison)
	i <<= 1;
	// EXPECT: assignment, shift in value → binary visual attached
	i = 1 << 4;
	// EXPECT: assignment, ternary value
	i = (i > 0) ? i : 0;
	// EXPECT: assignment, target index arr[0]
	arr[0] = i;
	// EXPECT: assignment, target member pt.x ('.')
	pt.x = 3;
	// EXPECT: assignment, target member pp->y ('->')
	pp->y = 7;
	// EXPECT: assignment, address-of value
	ptr = &i;
	// EXPECT: assignment, target deref *ptr — must NOT be read as a comment
	*ptr = 9;
	// FIXED (was TRAP): 2D index — target index used to be captured as "1][1".
	// GAP: 2D arrays aren't supported (see KNOWN_GAPS.md) → unknown
	grid[1][1] = 3;
	// FIXED (was TRAP): trailing comment used to be swallowed into the value.
	// EXPECT: assignment, value 7 (comment stripped, not part of the value)
	i = 7; // this whole comment becomes part of the value

	/* ---- increment / decrement, all four forms ---- */
	// EXPECT: incr_decr postfix ++
	i++;
	// EXPECT: incr_decr prefix ++
	++i;
	// EXPECT: incr_decr postfix --
	i--;
	// EXPECT: incr_decr prefix --
	--i;

	/* ---- bit shifts ---- */
	// EXPECT: bit_shift left, decimal → binary before/after visual
	255 << 16;
	// EXPECT: bit_shift right, hex literal → visual via parseShiftLiteral
	0xFF >> 4;
	// GAP: variable shift amount (regex wants digits) → unknown
	255 << i;
	// FIXED (was TRAP): amount >= 32 — JS '<<' wraps mod 32, so the visual
	// used to silently show before === after. Now the shift is still
	// recognized but the visual is omitted (words-only explanation).
	// EXPECT: bit_shift, no binary visual, explains why in words
	1 << 32;
	// FIXED (was TRAP): combined shifts used to merge into ONE bit_shift
	// (left "1 << 8 | 1", amount 16). A stray |/&/^ or second shift in the
	// captured left side is now rejected.
	// EXPECT: unknown (not a single trustworthy shift)
	1 << 8 | 1 << 16;

	/* ---- control flow ---- */
	// EXPECT: control_flow if
	if (i > 3 && arr[0] != 0)
		i = 0;
	// EXPECT: control_flow if (else-if collapses to 'if' by design)
	else if (i == MAX_ITER)
		i = 1;
	// EXPECT: control_flow else
	else
		i = 2;
	// EXPECT: control_flow while
	while (i < 10)
		i++;
	// EXPECT: control_flow for — all three clauses land in 'condition'
	for (i = 0; i < 10; i++)
		arr[i] = i;

	/* ---- function calls ---- */
	// FIXED (was TRAP): comma inside the string used to split the args at
	// the wrong places. Args now split on top-level commas only.
	// EXPECT: function_call, 3 args (format string, pt.x, pp->y)
	printf("point: %d,%d\n", pt.x, pp->y);
	// GAP: nested parens defeat the call regex ([^)]* stops too early)
	printf("%d\n", ABS(-5));

	/* ---- comments as input ---- */
	// EXPECT: comment (this very line)
	/* EXPECT: comment — single-line block comment */
	/*
	 * EXPECT: comment — mid-block line starting with '*' (not a deref!)
	 */

	/* ---- misparse traps ---- */
	// FIXED (was TRAP): comparison-as-statement used to parse as an
	// assignment with value "= 5" (the assignment regex matched the first
	// '=' of "=="). The '=' it matches must not itself start a "==".
	// EXPECT: unknown (a bare comparison statement is a no-op, not assignment)
	i == 5;

	/* ---- gaps: valid C that must fall through to unknown ---- */
	// GAP: 'const' is not in C_TYPES
	const int	limit = 10;
	// GAP: 'static' qualifier
	static int	count = 0;
	// GAP: multi-word type ('unsigned' matches, then chokes on 'int')
	unsigned int	flags = 0;
	// GAP: multi-declarator line
	int	a2, b2;
	// GAP: cast-to-void statement
	(void)argc;
	// GAP: 'struct' keyword declaration ('struct' not in C_TYPES)
	struct s_point	raw;
	// FIXED (was TRAP): 'switch (argc)' used to misparse as a FUNCTION CALL
	// named "switch"! Now explicitly guarded to unknown before the
	// function_call regex gets a chance to match it.
	// EXPECT: unknown (switch statements aren't supported — see KNOWN_GAPS.md)
	// (case / break / default below fall through to unknown too, which is fine)
	switch (argc)
	{
		case 1:
			break;
		default:
			break;
	}
	// GAP: do-while opener
	do
	{
		i--;
	// GAP: '} while (...)' closer of a do-while → unknown (leading brace)
	} while (i > 0);

	// keep -Wall quiet without changing any test line above
	raw.x = limit + (int)flags + a2 + b2 + msg[0] + small[0] + argv[0][0];
	arr[1] = count + raw.x;

	// EXPECT: control_flow return, condition 0 (no parens)
	return 0;
}

// EXPECT: preprocessor endif
#endif
