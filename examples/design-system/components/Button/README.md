# Button

A single action, verb first in sentence case: "Book a class", "Add to basket". Pass `label` and, for the one action the view is for, `variant: "primary"` (clay, at most once per view); everything else stays quiet. The consumer provides the click handler as `onClick`.

- Do: one primary per view, at the end of the reading order.
- Don't: two clay buttons side by side; icons without a label; "Click here".
