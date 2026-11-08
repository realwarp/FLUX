// Stateful, presentation-focused composer input for the terminal UI.

import type { InputKey, InputState } from "./types.js"

export function createInputState(value = "", history: readonly string[] = []): InputState {
  return { value, cursor: value.length, history, historyIndex: history.length }
}

export function applyInputKey(state: InputState, key: InputKey): InputState | { state: InputState; submitted: string } {
  if (key.type === "enter") {
    const submitted = state.value.trim()
    return {
      state: createInputState("", submitted ? [...state.history, submitted] : state.history),
      submitted,
    }
  }
  if (key.type === "character") {
    return { ...state, value: `${state.value.slice(0, state.cursor)}${key.value}${state.value.slice(state.cursor)}`, cursor: state.cursor + key.value.length, historyIndex: state.history.length }
  }
  if (key.type === "backspace" && state.cursor > 0) {
    return { ...state, value: `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`, cursor: state.cursor - 1 }
  }
  if (key.type === "delete" && state.cursor < state.value.length) {
    return { ...state, value: `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}` }
  }
  if (key.type === "left") return { ...state, cursor: Math.max(0, state.cursor - 1) }
  if (key.type === "right") return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) }
  if (key.type === "home") return { ...state, cursor: 0 }
  if (key.type === "end") return { ...state, cursor: state.value.length }
  if (key.type === "escape") return { ...state, value: "", cursor: 0, historyIndex: state.history.length }
  if (key.type === "up" || key.type === "down") {
    const nextIndex = key.type === "up"
      ? Math.max(0, state.historyIndex - 1)
      : Math.min(state.history.length, state.historyIndex + 1)
    const value = state.history[nextIndex] ?? ""
    return { ...state, value, cursor: value.length, historyIndex: nextIndex }
  }
  return state
}

export function renderComposer(state: InputState, width: number, focused = true): string {
  const prompt = focused ? "› " : "  "
  const available = Math.max(1, width - prompt.length)
  const start = Math.max(0, Math.min(state.cursor - available + 1, state.value.length - available))
  const visible = state.value.slice(start, start + available)
  const cursorOffset = Math.min(available - 1, Math.max(0, state.cursor - start))
  const before = visible.slice(0, cursorOffset)
  const cursor = visible[cursorOffset] ?? " "
  const after = visible.slice(cursorOffset + 1)
  const cursorText = focused ? `\u001b[7m${cursor}\u001b[0m` : cursor
  return `${prompt}${before}${cursorText}${after}`.padEnd(width)
}

