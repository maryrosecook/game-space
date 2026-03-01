import type { CSSProperties } from "react";

import type { HomepagePageData } from "../types";

type HomepageAppProps = {
  data: HomepagePageData;
};

export function HomepageApp({ data }: HomepageAppProps) {
  const content =
    data.tiles.length > 0 ? (
      <div className="game-grid" role="list">
        {data.tiles.map((tile) => (
          <a
            key={tile.id}
            className={`game-tile${tile.isFavorite ? " game-tile--favorite" : ""}`}
            href={tile.href}
            data-version-id={tile.id}
            data-tile-color={tile.tileColor}
            style={{ "--tile-color": tile.tileColor } as CSSProperties}
          >
            {tile.tileSnapshotPath ? (
              <img
                className="tile-image"
                src={tile.tileSnapshotPath}
                alt={tile.displayId}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="tile-image tile-image--placeholder" aria-hidden="true"></span>
            )}
            <span className="tile-id">{tile.displayId}</span>
          </a>
        ))}
      </div>
    ) : (
      <p className="empty-state">No game versions were found.</p>
    );

  return (
    <main className="homepage-shell">
      <header className="page-header page-header--with-auth">
        <h1>Fountain</h1>
        <div className="page-header-links">
          {data.showIdeasLink ? (
            <a className="auth-link" href="/ideas">
              Ideas
            </a>
          ) : null}
          <a className="auth-link" href="/auth">
            {data.authLabel}
          </a>
        </div>
      </header>
      {content}
    </main>
  );
}
