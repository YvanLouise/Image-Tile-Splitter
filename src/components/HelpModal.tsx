import { X } from "lucide-react";
import type { UIStrings } from "../i18n";

interface HelpModalProps {
  t: UIStrings;
  onClose: () => void;
}

export function HelpModal({ t, onClose }: HelpModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="help-title">{t.help.title}</h2>
            <p>{t.help.intro}</p>
          </div>
          <button className="icon-button" title={t.common.close} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="help-content">
          {t.help.sections.map((section) => (
            <article key={section.title} className="help-section">
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <footer className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t.common.close}
          </button>
        </footer>
      </section>
    </div>
  );
}
