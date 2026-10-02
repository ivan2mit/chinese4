// Перетаскивание на указателях (pointer events): одинаково работает мышью,
// пальцем и пером. Встроенный HTML5 drag&drop на сенсорных экранах не
// работает, поэтому он не используется.
//
// draggable(el, { payload, onOutside }) — элемент можно тянуть; обычный
//   щелчок без движения остаётся щелчком.
// dropTarget(el, handler)               — элемент принимает payload.
// Отпустили не на цель — вызывается onOutside (так ячейку «выбрасывают»).

const handlers = new WeakMap();
const THRESHOLD = 6;

export function dropTarget(el, handler) {
  el.dataset.drop = "1";
  handlers.set(el, handler);
}

function targetAt(x, y) {
  const found = document.elementFromPoint(x, y)?.closest("[data-drop]");
  return found && handlers.has(found) ? found : null;
}

export function draggable(el, { payload, onOutside = null }) {
  el.classList.add("is-draggable");
  el.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let ghost = null;
    let over = null;

    const move = (moveEvent) => {
      if (!ghost) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < THRESHOLD) return;
        const box = el.getBoundingClientRect();
        ghost = el.cloneNode(true);
        ghost.classList.add("pl-ghost");
        ghost.removeAttribute("id");
        Object.assign(ghost.style, { width: `${box.width}px`, height: `${box.height}px` });
        document.body.append(ghost);
        el.classList.add("is-dragging");
        document.body.classList.add("is-dnd");
      }
      moveEvent.preventDefault();
      ghost.style.left = `${moveEvent.clientX - ghost.offsetWidth / 2}px`;
      ghost.style.top = `${moveEvent.clientY - ghost.offsetHeight / 2}px`;
      const target = targetAt(moveEvent.clientX, moveEvent.clientY);
      if (target !== over) {
        over?.classList.remove("is-over");
        over = target;
        over?.classList.add("is-over");
      }
    };

    const finish = (endEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (!ghost) return;
      ghost.remove();
      over?.classList.remove("is-over");
      el.classList.remove("is-dragging");
      document.body.classList.remove("is-dnd");
      // Конец перетаскивания не должен считаться щелчком по исходной кнопке.
      const swallow = (clickEvent) => clickEvent.stopPropagation();
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      if (endEvent.type === "pointercancel") return;
      const target = targetAt(endEvent.clientX, endEvent.clientY);
      if (target) handlers.get(target)(payload);
      else onOutside?.();
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });
}
