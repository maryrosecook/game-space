import type { CSSProperties } from "react";

import type { GameLineageEntry } from "../types";
import { IconMarkup } from "./IconMarkup";

type GameLineageModalProps = {
  entries: readonly GameLineageEntry[];
  closeIcon: string;
  playIcon: string;
  trashIcon: string;
};

export function GameLineageModal({
  entries,
  closeIcon,
  playIcon,
  trashIcon,
}: GameLineageModalProps) {
  return (
    <div
      id="lineage-modal-backdrop"
      className="lineage-modal-backdrop"
      aria-hidden="true"
    >
      <section
        id="lineage-modal"
        className="lineage-modal"
        role="dialog"
        aria-modal="true"
        aria-hidden="true"
        aria-labelledby="lineage-modal-title"
      >
        <header className="lineage-modal-header">
          <h2 id="lineage-modal-title">Lineage</h2>
          <button
            id="lineage-modal-close"
            className="lineage-modal-close"
            type="button"
            aria-label="Close lineage modal"
          >
            <IconMarkup markup={closeIcon} />
          </button>
        </header>
        {entries.length > 0 ? (
          <ul id="lineage-list" className="lineage-list">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={`lineage-list-item${entry.isCurrent ? " lineage-list-item--current" : ""}`}
                data-lineage-row="true"
                data-lineage-version-id={entry.id}
                data-lineage-version-href={entry.href}
              >
                <div
                  className="lineage-list-item-preview"
                  style={{ "--tile-color": entry.tileColor } as CSSProperties}
                >
                  {entry.tileSnapshotPath ? (
                    <img
                      className="lineage-list-item-image"
                      src={entry.tileSnapshotPath}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span
                      className="lineage-list-item-image lineage-list-item-image--placeholder"
                      aria-hidden="true"
                    ></span>
                  )}
                </div>
                <div className="lineage-list-item-copy">
                  <p className="lineage-list-item-title">{entry.displayId}</p>
                  <p className="lineage-list-item-status">
                    {entry.isCurrent ? "Current clone" : "Clone"}
                  </p>
                </div>
                <div className="lineage-list-item-actions">
                  <button
                    className="lineage-list-item-action"
                    type="button"
                    data-lineage-action="play"
                    data-lineage-version-id={entry.id}
                    data-lineage-version-href={entry.href}
                    disabled={entry.isCurrent}
                    aria-label={
                      entry.isCurrent
                        ? `Already playing ${entry.displayId}`
                        : `Play ${entry.displayId}`
                    }
                  >
                    <IconMarkup markup={playIcon} />
                  </button>
                  <button
                    className="lineage-list-item-action lineage-list-item-action--delete"
                    type="button"
                    data-lineage-action="delete"
                    data-lineage-version-id={entry.id}
                    aria-label={`Delete ${entry.displayId}`}
                  >
                    <IconMarkup markup={trashIcon} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <p
          id="lineage-modal-empty"
          className="lineage-modal-empty"
          hidden={entries.length > 0}
        >
          No clones in this lineage yet.
        </p>
      </section>
    </div>
  );
}
