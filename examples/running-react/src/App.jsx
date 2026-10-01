import { useEffect, useRef, useState } from 'react';

export function App() {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null); const close = useRef(null);
  useEffect(() => { if (open) close.current?.focus(); }, [open]);
  function dismiss() { setOpen(false); queueMicrotask(() => trigger.current?.focus()); }
  return <main>
    <p className="eyebrow">React + Vite fixture</p>
    <h1 id="title">A measured interface.</h1>
    <p>Configured values come from the bundled constitution.</p>
    <button id="open" className="primary" ref={trigger} onClick={() => setOpen(true)}>Review interface</button>
    {open && <section id="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={event => {
      if (event.key === 'Escape') dismiss();
      if (event.key === 'Tab') event.preventDefault();
    }}>
      <h2 id="dialog-title">Review</h2><p>This is a local fixture.</p>
      <button id="close" ref={close} onClick={dismiss}>Close review</button>
    </section>}
  </main>;
}
