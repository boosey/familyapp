/**
 * Account surface layout (ADR-0029) — the shared chrome around every section panel: a left rail on
 * wide viewports and a section drill-down on narrow (the rail becomes a pushed list opened from the
 * panel's "Sections" toggle, with a back affordance). Purely CSS-driven responsiveness
 * (account-shell.module.css) so there is NO vertical bloat on a phone (the HubTabs / ADR-0024-0025
 * lesson): the rail never stacks above the panel — it is an overlay list.
 *
 * FROZEN shell — section agents replace their own `sections/<slug>/index.tsx`, never this file.
 */
import { hub } from "@/app/_copy";
import { ACCOUNT_SECTIONS } from "./account-sections";
import { AccountRail } from "./AccountRail";
import styles from "./account-shell.module.css";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const sections = ACCOUNT_SECTIONS.map((s) => ({
    slug: s.slug,
    label: s.label,
    scope: s.scope,
  }));

  return (
    <main className={styles.shell}>
      <div className={styles.inner}>
        <div className={styles.columns}>
          <AccountRail
            sections={sections}
            copy={{
              sectionsLabel: hub.accountShell.sections,
              backToHub: hub.accountShell.backToHub,
              deviceScope: hub.accountShell.deviceScope,
              accountScope: hub.accountShell.accountScope,
            }}
          />
          <div className={styles.panel}>{children}</div>
        </div>
      </div>
    </main>
  );
}
