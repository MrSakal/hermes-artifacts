# Interactive artboards: events, state, links

Mark the artboard `"is_interactive": true` in its `boards` entry (working controls; blue mark + Play).

- **Events**: whole-value JSX camelCase, `onClick="{{ pick }}"` (`pick` from `renderVals()`). They run only
  in Play, full-window view and HTML export; never while editing. Text field `onChange` per keystroke
  (`e.target.value`). Selection: in `state`, one handler per item:
  `items: xs.map((x) => ({ ...x, pick: () => this.setState({ picked: x.id }) }))`,
  `onClick="{{ item.pick }}"` inside `<sc-for>`.
- **Logic class**: `this.props`, `this.state`, `setState(partial | fn, cb)`, `forceUpdate()`,
  `createRef()`, `static getDerivedStateFromProps`, `componentDidMount`, `componentDidUpdate(prevProps,
  prevState)`, `componentWillUnmount`; no `render()`. State: class field (`state = {...}`) or
  constructor after `super(props)`. `renderVals()` returns values, arrays, handlers, refs
  (`ref="{{ box }}"`, `box: this.boxRef`).
- **Live state styling**: style holes are for live state (and declared tweaks); precompute per item in
  `renderVals()` (`style` or `selected`) and bind, or `<sc-if>`.
- **Links**: `<a href="Cart.dc.html">` moves Play there (not while editing); relative, leading `/` =
  canvas root. Style the `<a>` as the button (an inner `<button>` swallows clicks). `#id` scrolls;
  `https://…` opens a tab.
- `state` is per artboard: a flow sharing state = ONE artboard, `<sc-if>` per screen.
- No global keydown handlers.
