export const AUTOFILL_STYLES = `
  :host {
    --peach-bg: rgba(12, 12, 16, 0.92);
    --peach-border: rgba(255, 255, 255, 0.08);
    --peach-glow: rgba(255, 107, 138, 0.3);
    --peach-accent: #FF9A6C;
    --peach-accent-2: #FF6B8A;
    --peach-text: #f8fafc;
    --peach-text-muted: rgba(248, 250, 252, 0.6);
    --peach-text-dim: rgba(248, 250, 252, 0.4);
    --peach-hover: rgba(255, 255, 255, 0.06);
    --peach-success: #10b981;
    --peach-warning: #f59e0b;
    --peach-error: #ef4444;
    --peach-row-height: 44px;
    --peach-radius: 12px;
    --peach-radius-sm: 8px;
    --peach-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    --peach-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --peach-mono: 'Geist Mono', 'SF Mono', Monaco, monospace;
    
    all: initial;
    font-family: var(--peach-font);
    box-sizing: border-box;
  }

  *, *::before, *::after {
    box-sizing: inherit;
  }

  .peach-dropdown {
    position: fixed;
    min-width: 280px;
    max-width: 360px;
    background: var(--peach-bg);
    border: 1px solid var(--peach-border);
    border-radius: var(--peach-radius);
    box-shadow: var(--peach-shadow);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    z-index: 2147483647;
    overflow: hidden;
    animation: peach-slide-down 120ms ease-out;
    color: var(--peach-text);
    font-size: 13px;
    line-height: 1.4;
  }

  @keyframes peach-slide-down {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes peach-fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  .peach-dropdown.closing {
    animation: peach-fade-out 80ms ease-out forwards;
  }

  .peach-dropdown-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--peach-border);
    background: linear-gradient(135deg, rgba(255, 154, 108, 0.1), rgba(255, 107, 138, 0.1));
  }

  .peach-logo {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--peach-accent), var(--peach-accent-2));
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .peach-logo svg {
    width: 12px;
    height: 12px;
    fill: white;
  }

  .peach-brand {
    font-weight: 600;
    font-size: 14px;
    background: linear-gradient(135deg, var(--peach-accent), var(--peach-accent-2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .peach-dropdown-body {
    max-height: 240px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .peach-dropdown-body::-webkit-scrollbar {
    width: 6px;
  }

  .peach-dropdown-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .peach-dropdown-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }

  .peach-credential-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    cursor: pointer;
    transition: background-color 150ms ease;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .peach-credential-row:last-child {
    border-bottom: none;
  }

  .peach-credential-row:hover {
    background: var(--peach-hover);
  }

  .peach-credential-row:focus {
    outline: none;
    background: var(--peach-hover);
  }

  .peach-favicon {
    width: 32px;
    height: 32px;
    border-radius: var(--peach-radius-sm);
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .peach-favicon img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  .peach-favicon-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--peach-accent), var(--peach-accent-2));
    color: white;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .peach-credential-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .peach-credential-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--peach-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .peach-credential-username {
    font-size: 11px;
    color: var(--peach-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .peach-credential-arrow {
    width: 16px;
    height: 16px;
    color: var(--peach-text-dim);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .peach-credential-row:hover .peach-credential-arrow {
    opacity: 1;
  }

  .peach-dropdown-footer {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--peach-border);
    background: rgba(0, 0, 0, 0.2);
  }

  .peach-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--peach-border);
    border-radius: var(--peach-radius-sm);
    background: rgba(255, 255, 255, 0.05);
    color: var(--peach-text-muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms ease;
    text-decoration: none;
  }

  .peach-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--peach-text);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .peach-btn-primary {
    background: linear-gradient(135deg, rgba(255, 154, 108, 0.2), rgba(255, 107, 138, 0.2));
    border-color: rgba(255, 154, 108, 0.3);
    color: var(--peach-accent);
  }

  .peach-btn-primary:hover {
    background: linear-gradient(135deg, rgba(255, 154, 108, 0.3), rgba(255, 107, 138, 0.3));
  }

  .peach-empty-state {
    padding: 24px 16px;
    text-align: center;
    color: var(--peach-text-muted);
    font-size: 13px;
  }

  .peach-warning-banner {
    padding: 10px 16px;
    background: rgba(239, 68, 68, 0.15);
    border-bottom: 1px solid rgba(239, 68, 68, 0.3);
    font-size: 11px;
    color: #fca5a5;
  }

  .peach-warning-banner strong {
    display: block;
    margin-bottom: 2px;
    color: #f87171;
  }

  .peach-loading {
    padding: 24px;
    text-align: center;
    color: var(--peach-text-muted);
  }

  .peach-loading::after {
    content: '';
    display: inline-block;
    width: 16px;
    height: 16px;
    margin-left: 8px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--peach-accent);
    border-radius: 50%;
    animation: peach-spin 1s linear infinite;
  }

  @keyframes peach-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .peach-icon {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--peach-accent), var(--peach-accent-2));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: all 150ms ease;
    opacity: 0;
    animation: peach-icon-appear 150ms ease-out forwards;
  }

  @keyframes peach-icon-appear {
    from {
      opacity: 0;
      transform: translateY(-50%) scale(0.8);
    }
    to {
      opacity: 1;
      transform: translateY(-50%) scale(1);
    }
  }

  .peach-icon:hover {
    box-shadow: 0 0 12px var(--peach-glow), 0 2px 8px rgba(0, 0, 0, 0.3);
    transform: translateY(-50%) scale(1.1);
  }

  .peach-icon svg {
    width: 10px;
    height: 10px;
    fill: white;
  }

  .peach-icon-success {
    background: linear-gradient(135deg, #10b981, #059669);
    animation: peach-success-pulse 1.5s ease-out;
  }

  @keyframes peach-success-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(16, 185, 129, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
    }
  }

  .peach-icon-wrapper {
    position: relative;
    display: inline-block;
    width: 100%;
  }
`;
