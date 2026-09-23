export async function copyText(text: string, status: HTMLElement, fallback: string) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = 'Copied. Nothing has been sent.';
  } catch {
    status.textContent = `Copy unavailable. Select the ${fallback} and copy it manually.`;
  }
}

export function wireCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => {
      const source = document.getElementById(button.dataset.copy!);
      const status = button.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
      if (!source || !status) return;
      const text = source instanceof HTMLTextAreaElement ? source.value : source.innerText;
      void copyText(text, status, 'text above');
    });
  });
}
