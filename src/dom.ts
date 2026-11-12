// DOM helpers for the popup and the settings page.

/** Returns the element with the given id, which the page's HTML is expected to contain. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

export function showMessage(element: HTMLElement, text: string, isError = false): void {
  element.textContent = text;
  element.classList.toggle("error", isError);
}
