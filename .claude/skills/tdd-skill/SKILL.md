---
name: tdd-skill
description: Test-first discipline for agentic implementation. Preloaded in the implementer subagent.
---
# Agentic TDD

For each behavior-bearing task in the plan:
1. Write a failing test that describes the expected behavior.
2. Run it and watch it fail. Not optional: a test you never saw fail proves nothing.
3. Write the minimum code to make it pass.
4. Run the suite. Refactor if needed, tests always green.
5. Tick the task's checkbox in the plan. No commit here.

A task that only changes copy, styling, spacing, responsive composition or
other presentation with no conditional behavior does not require a synthetic
unit test. Verify it with the focused lint/typecheck required by the project
and a browser or visual check at the affected viewport/theme. Record that
evidence before ticking the task.

Rules:
- No new business behavior, data contract, state transition, permission,
  validation or interaction without a test motivating it. Purely visual or
  copy-only production changes use visual verification instead of decorative
  component tests.
- Test behavior, not implementation: assert what the user gets, not which internal function got called.
- Minimal scope: YAGNI. Implement the task, nothing more.
- One commit per story, not per task, tests green at commit. It carries the code of every task and the plan file with its checkboxes ticked — the plan is the live progress tracker, never a commit trigger.

## Where the value is

Ranked, and the ranking is not negotiable:

1. **Business rules** — validation, permissions, the decisions that make the product refuse or accept. On every refusal assert BOTH that it was refused AND that nothing was written or read further down: a refusal that still reaches the data layer is a leak, not a refusal.
2. **Pure functions** — derivations, validators, orderings, parsers. Cheap, precise, they pin the invariants. Extract a rule into a pure function *so that* it can be tested this way.
3. **Persistence shape** — the queries actually emitted, and the constraints that carry a business rule.
4. **Screens** — conditional behavior and user interactions: what is refused,
   what changes state, where an action navigates, and whether a meaningful
   empty/error state replaces misleading data. Never test markup, CSS classes,
   breakpoint utility names or static inventory.

### Frontend test decision

Add a component or browser test only when at least one answer is yes:

- Does user interaction produce an outcome that can silently regress?
- Does conditional rendering distinguish materially different states?
- Does an accessible name, role or focus behavior enable the action?
- Does the component transform domain data into a decision the user relies on?

Otherwise use visual verification. A label deserves an assertion only when it
is itself a contract: an accessible control name, a status distinction, a
legal/safety warning or a refusal reason. Ordinary headings, helper copy and
translated wording do not each need their own component test.

## Where it is proven is not a free choice

**Anything shared is proven once at itself, and once at its callers that it is applied.**

- A rule is proven beside the rule. Tests at the edges routinely replace the layer underneath with a double: the real rule never runs, so the test proves the plumbing and nothing about the rule. Never accept "the endpoint is tested, therefore the rule is tested" — one edge test for the plumbing is enough.
- The actors a rule distinguishes are enumerated **once, at the rule**. Each caller gets a single refusal witness, proof that the rule is invoked at all — never a re-enumeration. A matrix repeated at N callers multiplies the suite by N and exercises the same decision through a different door.

## The cost the suite pays

Runtime is dominated by **per-file** cost — environment setup and module loading — not by the number of assertions. Measure it once on the project before optimising anything.

- **One test file per unit under test, never one per behavior.** Adding a case to an existing file is nearly free; creating a file is not. Caught yourself opening a second file for the same unit? Add a group inside the first.
- **A story adds at most two new test files.** Beyond that, fold the cases in. If a story genuinely needs more, say so in your report with the reason — it signals the story is too big, like a plan growing past ten tasks.
- **The heavy environment only where it is needed.** A file that never renders anything runs in the light one.

## The acceptance criterion is the mutation, not the count

Before ticking a behavior-bearing task: **neutralize the invariant you just
protected and watch the right test go red.** Remove the guard, invert the
condition, return early — then run. Do not invent a mutation for a visual-only
task; record its browser/visual evidence instead.

- Nothing goes red → the test is decorative. Delete it and write the one that bites, or state in your report that this behavior is untested.
- The wrong test goes red → the coverage is accidental. Move the assertion to where the rule lives.

Restore the mutation immediately, and name in your summary which mutations you
ran and how many tests each turned red. A behavior-bearing story that cannot
name a single biting mutation has not been tested, whatever its test count
says. A presentation-only task reports visual evidence instead.

## Do not write these

- **Inventory tests** freezing a list against a literal copy of itself. Red on every legitimate addition, blind to every defect.
- **Mock echo**: asserting a double was called with what the test just handed it. That tests the double.
- **Snapshots of markup**, and any assertion on class names or structure.
- **Responsive-by-class tests** such as asserting `sm:hidden`, `md:flex` or a
  Tailwind token. Verify the rendered viewport in a browser instead.
- **Static-copy tests** whose only failure is a harmless wording change. Test
  copy only when the words carry an accessibility, status, refusal, legal or
  safety contract.
- **Prop echo tests** that prove a component prints the literal value the test
  just passed without any branching or transformation.
- **Substring coverage** of documentation or registries: a name contained in a longer one is "covered" by it, and the guarantee is an illusion.
- **A test written to raise a coverage number.** This method sets no coverage target, deliberately: that metric manufactures suites that are large, slow and blind.

## When it goes wrong

- The new test passes immediately → it doesn't test the new behavior. Rewrite the test, not the code.
- The tests can't run → stop and report. Never "skip testing just this once".
- The test is flaky → fix the flakiness first; a flaky test guards nothing.
- The behavior is only reachable through a replaced boundary → push the rule down into a unit you can test directly, and test it there.

<< IP Mike: test runner and commands, environment names, layer vocabulary, the actors a rule must distinguish, naming and file layout of test files. >>
