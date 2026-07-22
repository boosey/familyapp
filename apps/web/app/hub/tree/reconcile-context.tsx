"use client";
/**
 * TreeReconcileContext — thin re-export of #337 reconcile opener for tests that only need the
 * reconcile callback without the full TreeCallbacksProvider surface. Production TreeCanvas wires
 * reconcile via TreeCallbacksProvider (`useTreeReconcile`).
 */
export {
  useTreeReconcile,
  type ReconcilePerson as ReconcilePersonFn,
} from "./tree-callbacks-context";
import { TreeCallbacksProvider, type ReconcilePerson } from "./tree-callbacks-context";
import type { ReactNode } from "react";

/** Test helper: provide only `reconcilePerson`; other tree callbacks stay no-ops. */
export function TreeReconcileProvider({
  value,
  children,
}: {
  value: ReconcilePerson;
  children: ReactNode;
}) {
  return (
    <TreeCallbacksProvider
      value={{
        openAdd: () => {},
        focusPerson: () => {},
        invitePerson: () => {},
        reconcilePerson: value,
      }}
    >
      {children}
    </TreeCallbacksProvider>
  );
}
