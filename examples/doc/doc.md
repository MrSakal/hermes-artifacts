# Quote – process

This document describes the steps from the **request for a quote** to the *contract*. Details: <https://example.com/process>.

## Steps

1. A request for a quote arrives
2. Site survey
   - photos, measurements
   - [x] request the structural data
   - [ ] pricing
3. Send the quote

> The quote is valid for 30 days, unless the exchange rate moves more than 5%.

## Deadlines

| Step | Owner | Deadline |
|:------|:--------|---------:|
| Survey | Sales | 3 days |
| Pricing | Estimating | 5 days |
| Sending | Sales | 1 day |

---

### Code sample

```js
const due = addDays(today, 5)
```

