/** Mutations exist only in the local test server, never in the working example. */
export function injectDefect(html, defect = '') {
  const changes = {
    target: ['</style>', '#save { width:24px; height:24px; min-width:0; min-height:0; padding:0; font-size:5px; }</style>'],
    focus: ['</style>', 'button:focus-visible { outline:none; box-shadow:none; }</style>'],
    contrast: ['</style>', 'button:focus-visible { outline-color:rgb(250,250,250); }</style>'],
    name: ['aria-labelledby="confirm-title"', ''],
    initial: ['modal.showModal(); cancel.focus();', 'modal.show(); trigger.focus();'],
    containment: ["if (event.key !== 'Tab') return;", 'return;'],
    escape: ["modal.addEventListener('close',", "modal.addEventListener('cancel', event => event.preventDefault());\n    modal.addEventListener('close',"],
    return: ["modal.addEventListener('close', () => trigger.focus());", "modal.addEventListener('close', () => workspace.focus());"],
  };
  if (!defect) return html;
  if (!Object.hasOwn(changes, defect)) throw new Error('Unknown defect');
  const [before, after] = changes[defect];
  if (!html.includes(before)) throw new Error(`Fixture mutation ${defect} no longer matches source`);
  return html.replace(before, after);
}
