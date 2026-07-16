// kind: comment
// This file exercises every ParsedLine kind supported after Phase 1.

/*
 * kind: comment (block comment lines)
 * multiplies two numbers
 */

// kind: preprocessor (include, system header)
#include <stdio.h>
// kind: preprocessor (include, local header)
#include "fractol.h"

// kind: preprocessor (ifndef header guard)
#ifndef FRACTOL_H
// kind: preprocessor (define, simple constant / guard marker)
#define FRACTOL_H
// kind: preprocessor (define, function-like macro)
#define SQUARE(x) ((x) * (x))
// kind: preprocessor (endif)
#endif

// kind: block_open (typedef struct opener, Allman-style brace)
typedef struct s_point
{
	// kind: variable_decl (struct member, plain)
	int x;
	// kind: variable_decl (struct member, plain)
	int y;
// kind: block_close (typedef closer)
} t_point;

// kind: block_open (enum opener)
enum e_color
{
	RED,
	GREEN,
	BLUE
// kind: block_close (bare closer)
};

// kind: function_def (main, argc/argv special case)
int main(int argc, char **argv)
{
	// kind: variable_decl (with initial value)
	int x = 5;

	// kind: variable_decl (bare pointer, no initial value)
	char *str;

	// kind: variable_decl (fixed-size array)
	int arr[10];

	// kind: variable_decl (size-inferred array with string initializer)
	char name[] = "hi";

	// kind: variable_decl (custom struct type, plain)
	t_point origin;

	// kind: variable_decl (cast in initializer)
	t_point *p = (t_point *)malloc(sizeof(t_point));

	// kind: variable_decl (pointer initialized via address-of)
	int *addr = &x;

	// kind: assignment (plain)
	x = 5;

	// kind: assignment (compound +=)
	x += 1;

	// kind: assignment (shift embedded in the value, see KNOWN_GAPS.md history)
	x = 1 << 3;

	// kind: assignment (array indexing on the left-hand side)
	arr[0] = 5;

	// kind: assignment (pointer dereference)
	*str = 'h';

	// kind: assignment (arrow / struct-pointer member access)
	p->x = 800;

	// kind: assignment (dot / struct-value member access)
	origin.x = 3;

	// kind: assignment (ternary value)
	x = (x > 0) ? x : 0;

	// kind: incr_decr (postfix)
	x++;

	// kind: incr_decr (prefix)
	--x;

	// kind: bit_shift
	255 << 16;

	// kind: control_flow (if)
	if (x == 5)
	{
		// kind: function_call (known function, printf)
		printf("x is 5\n");

		// kind: control_flow (return, with value)
		return 0;
	}
	// kind: control_flow (else)
	else
	{
		// kind: control_flow (while)
		while (x < 10)
		{
			x += 1;
		}

		// kind: control_flow (for, with special setup/condition/step breakdown)
		for (x = 0; x < 10; x++)
		{
			// kind: function_call (known function, write)
			write(1, "A", 1);
		}
	}

	// kind: function_call (known function, malloc)
	malloc(20);

	// kind: function_call (unmapped, falls back to generic sentence)
	close_window(p);

	// kind: control_flow (return, bare)
	return;
}

// kind: unknown (switch statements are not yet supported — see KNOWN_GAPS.md)
switch (x) {
