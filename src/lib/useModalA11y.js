// A-2 (audit H5): Shared a11y polish for modal dialogs.
//
// Use inside any modal component that's already styled with role="dialog" +
// aria-modal="true". Adds three behaviors you should not have to repeat:
//
//   1. ESC key closes the modal (calls onClose).
//   2. Focus stays inside the modal — Tab cycles within focusable children
//      instead of bouncing out to the page underneath (screen readers and
//      keyboard users get stuck otherwise).
//   3. When the modal closes, focus returns to whichever element was
//      focused before it opened — usually the button that triggered it.
//      Without this, focus snaps to <body> and keyboard users lose place.
//
// Usage:
//   const cardRef = useModalA11y({ isOpen, onClose });
//   return <div ref={cardRef} role="dialog" aria-modal="true">…</div>;
//
// Note: ConfirmModal.jsx implements the same pattern inline. This hook
// extracts it so PaywallScreen / WhatsNewModal / CompareView / Scanner
// can share it without copy-paste.

import { useEffect, useRef } from "react";

export function useModalA11y({ isOpen, onClose, autoFocus = true }) {
  const cardRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // 1. Capture whatever had focus before we opened (usually the trigger).
    previouslyFocused.current =
      typeof document !== "undefined" ? document.activeElement : null;

    // 2. Auto-focus the first focusable element inside the modal so screen
    //    readers and keyboard nav don't have to hunt.
    if (autoFocus && cardRef.current) {
      const focusables = cardRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length > 0) {
        // Defer one tick so any animation/mount completes first.
        const t = setTimeout(() => {
          try { focusables[0].focus(); } catch {}
        }, 60);
        return () => clearTimeout(t);
      }
    }
  }, [isOpen, autoFocus]);

  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;

      // Focus trap — cycle Tab inside the modal.
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // On close, restore focus to the previously-focused element.
  useEffect(() => {
    if (isOpen) return;
    const prev = previouslyFocused.current;
    if (prev && typeof prev.focus === "function") {
      try { prev.focus(); } catch {}
    }
    previouslyFocused.current = null;
  }, [isOpen]);

  return cardRef;
}
