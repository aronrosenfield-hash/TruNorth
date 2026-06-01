// Themed modal system for TruNorth — replaces native alert/confirm/prompt
// dialogs (which render as "trunorthapp.com says:" scam-looking popups on
// Android Chrome).
//
// Usage: wrap the app in <ConfirmProvider>, then call useConfirm(),
// usePrompt(), or useAlert() to get a promise-returning function.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { T } from "../lib/theme";

// ---------- context ----------

const ConfirmCtx = createContext(null);

function useStack() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) {
    throw new Error(
      "ConfirmModal hooks must be used inside <ConfirmProvider>. Wrap your app root with it."
    );
  }
  return ctx;
}

// ---------- public hooks ----------

/** Returns { confirm({ title, body, confirmLabel, cancelLabel, danger }) -> Promise<boolean> } */
export function useConfirm() {
  const { push } = useStack();
  const confirm = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        push({ type: "confirm", opts, resolve });
      }),
    [push]
  );
  return { confirm };
}

/** Returns { prompt({ title, body, placeholder, defaultValue, confirmLabel, cancelLabel, danger }) -> Promise<string|null> } */
export function usePrompt() {
  const { push } = useStack();
  const prompt = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        push({ type: "prompt", opts, resolve });
      }),
    [push]
  );
  return { prompt };
}

/** Returns { alert({ title, body, kind: 'info'|'success'|'error' }) -> Promise<void> } */
export function useAlert() {
  const { push } = useStack();
  const alert = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        push({ type: "alert", opts, resolve: () => resolve() });
      }),
    [push]
  );
  return { alert };
}

// ---------- provider ----------

export function ConfirmProvider({ children }) {
  const [stack, setStack] = useState([]);

  const push = useCallback((entry) => {
    const id = Math.random().toString(36).slice(2);
    setStack((s) => [...s, { ...entry, id }]);
  }, []);

  const resolveTop = useCallback((id, value) => {
    setStack((s) => {
      const idx = s.findIndex((x) => x.id === id);
      if (idx === -1) return s;
      s[idx].resolve(value);
      const next = s.slice();
      next.splice(idx, 1);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {stack.map((entry, i) => (
        <ConfirmModal
          key={entry.id}
          entry={entry}
          isTop={i === stack.length - 1}
          depth={i}
          onResolve={(v) => resolveTop(entry.id, v)}
        />
      ))}
    </ConfirmCtx.Provider>
  );
}

// ---------- modal ----------

function ConfirmModal({ entry, isTop, depth, onResolve }) {
  const { type, opts } = entry;
  const {
    title,
    body,
    confirmLabel,
    cancelLabel,
    danger,
    placeholder,
    defaultValue,
    kind = "info",
  } = opts || {};

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [value, setValue] = useState(defaultValue ?? "");
  const inputRef = useRef(null);
  const primaryBtnRef = useRef(null);
  const cardRef = useRef(null);
  const titleId = useId();
  const bodyId = useId();

  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 600px)").matches;

  // Open animation: mount -> next frame -> open
  useLayoutEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Auto-focus
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (type === "prompt" && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select?.();
      } else if (primaryBtnRef.current) {
        primaryBtnRef.current.focus();
      }
    }, 60);
    return () => clearTimeout(t);
  }, [open, type]);

  // Lock body scroll while any modal is open (only the top one needs to do it,
  // but cheap enough to do per-modal — they re-set the same value)
  useEffect(() => {
    if (!isTop) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isTop]);

  const handleClose = useCallback(
    (result) => {
      if (closing) return;
      setClosing(true);
      setOpen(false);
      // Wait for transition before resolving / unmounting
      setTimeout(() => onResolve(result), 200);
    },
    [closing, onResolve]
  );

  const handleCancel = useCallback(() => {
    if (type === "confirm") handleClose(false);
    else if (type === "prompt") handleClose(null);
    else handleClose();
  }, [type, handleClose]);

  const handleConfirm = useCallback(() => {
    if (type === "confirm") handleClose(true);
    else if (type === "prompt") handleClose(value);
    else handleClose();
  }, [type, value, handleClose]);

  // Keyboard handling — only on the top modal
  useEffect(() => {
    if (!isTop) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && type !== "prompt") {
        // For prompt, Enter in input is handled by the form submit
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Tab") {
        // Focus trap
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isTop, handleCancel, handleConfirm, type]);

  // ---------- styles ----------

  const accentForKind =
    kind === "success" ? "#3ecf8e" : kind === "error" ? T.rep : T.accent2;

  const backdropStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)",
    zIndex: 1000 + depth * 2,
    opacity: open ? 1 : 0,
    transition: "opacity 200ms ease",
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    padding: isMobile ? 0 : 16,
  };

  const cardStyle = isMobile
    ? {
        width: "100%",
        maxWidth: 560,
        background: T.bg2,
        color: T.txt,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        border: `1px solid ${T.border}`,
        borderBottom: "none",
        padding: 20,
        paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 200ms cubic-bezier(.2,.8,.2,1)",
        zIndex: 1001 + depth * 2,
      }
    : {
        width: "min(440px, 100%)",
        background: T.bg2,
        color: T.txt,
        borderRadius: 16,
        border: `1px solid ${T.border}`,
        padding: 24,
        boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
        transform: open ? "scale(1)" : "scale(0.96)",
        opacity: open ? 1 : 0,
        transition: "transform 200ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease",
        zIndex: 1001 + depth * 2,
      };

  const titleStyle = {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: T.txt,
    letterSpacing: "-0.01em",
  };

  const bodyStyle = {
    margin: "10px 0 0 0",
    fontSize: 14,
    lineHeight: 1.5,
    color: T.txt2,
  };

  const inputStyle = {
    marginTop: 16,
    width: "100%",
    boxSizing: "border-box",
    fontSize: 16, // prevent iOS auto-zoom
    padding: "12px 14px",
    borderRadius: 10,
    border: `1px solid ${T.border2}`,
    background: T.bg3,
    color: T.txt,
    outline: "none",
  };

  const btnRowStyle = {
    display: "flex",
    gap: 10,
    marginTop: 20,
    flexDirection: isMobile ? "column-reverse" : "row",
    justifyContent: "flex-end",
  };

  const baseBtnStyle = {
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 18px",
    borderRadius: 10,
    border: "1px solid transparent",
    cursor: "pointer",
    minHeight: 44,
    transition: "background 150ms ease, transform 80ms ease",
    width: isMobile ? "100%" : "auto",
  };

  const cancelBtnStyle = {
    ...baseBtnStyle,
    background: "transparent",
    color: T.txt2,
    border: `1px solid ${T.border2}`,
  };

  const confirmBtnStyle = {
    ...baseBtnStyle,
    background: danger ? T.rep : T.accent,
    color: "#fff",
  };

  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget) handleCancel();
  };

  // Accent strip for alert (small color cue)
  const showAccent = type === "alert";

  const content = (
    <div
      style={backdropStyle}
      onClick={onBackdropClick}
      aria-hidden={!isTop}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={body ? bodyId : undefined}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {isMobile && (
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: T.border2,
              margin: "0 auto 16px",
            }}
          />
        )}

        {showAccent && (
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 3,
              borderRadius: 2,
              background: accentForKind,
              marginBottom: 12,
            }}
          />
        )}

        {title && (
          <h2 id={titleId} style={titleStyle}>
            {title}
          </h2>
        )}
        {body && (
          <p id={bodyId} style={bodyStyle}>
            {body}
          </p>
        )}

        {type === "prompt" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder || ""}
              style={inputStyle}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div style={btnRowStyle}>
              <button
                type="button"
                onClick={handleCancel}
                style={cancelBtnStyle}
              >
                {cancelLabel || "Cancel"}
              </button>
              <button
                ref={primaryBtnRef}
                type="submit"
                style={confirmBtnStyle}
              >
                {confirmLabel || "OK"}
              </button>
            </div>
          </form>
        )}

        {type === "confirm" && (
          <div style={btnRowStyle}>
            <button onClick={handleCancel} style={cancelBtnStyle}>
              {cancelLabel || "Cancel"}
            </button>
            <button
              ref={primaryBtnRef}
              onClick={handleConfirm}
              style={confirmBtnStyle}
            >
              {confirmLabel || "Confirm"}
            </button>
          </div>
        )}

        {type === "alert" && (
          <div style={btnRowStyle}>
            <button
              ref={primaryBtnRef}
              onClick={handleConfirm}
              style={{
                ...confirmBtnStyle,
                background: accentForKind,
              }}
            >
              {confirmLabel || "OK"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

export default ConfirmModal;
