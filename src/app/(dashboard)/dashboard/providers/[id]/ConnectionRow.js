"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Badge, Toggle, Tooltip, Modal, Button } from "@/shared/components";
import CooldownTimer from "./CooldownTimer";

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, onUnlock = null, oneByOneStatus = null, autoPing = null }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockFeedback, setUnlockFeedback] = useState(null);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired → treat as active
    : connection.testStatus;

  // Extract Google validation challenge URL if present on connection or in error details
  const effectiveValidationUrl = connection.validationUrl || (() => {
    if (!connection.lastError && !connection.lastErrorDetail) return null;
    const combined = `${connection.lastError || ""} ${connection.lastErrorDetail || ""}`;
    const m = combined.match(/https:\/\/accounts\.google\.com\/signin\/continue[^\s"'}\]]+/);
    return m ? m[0] : null;
  })();

  const isGoogleVerificationIssue =
    !!effectiveValidationUrl ||
    (connection.lastError &&
      (/verify your account/i.test(connection.lastError) ||
        /VALIDATION_REQUIRED/i.test(connection.lastError) ||
        (/403/i.test(connection.lastError) && (connection.provider === "antigravity" || connection.provider === "gemini-cli"))));

  const handleUnlock = async () => {
    if (unlocking) return;
    setUnlocking(true);
    setUnlockFeedback(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}/unlock`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsCooldown(false);
        setUnlockFeedback({ type: "success", text: "Conta liberada!" });
        if (onUnlock) {
          onUnlock(data.connection);
        }
        setTimeout(() => setUnlockFeedback(null), 3500);
      } else {
        setUnlockFeedback({ type: "error", text: data.error || "Erro ao liberar." });
        setTimeout(() => setUnlockFeedback(null), 4000);
      }
    } catch (err) {
      console.error("Failed to unlock connection:", err);
      setUnlockFeedback({ type: "error", text: err.message || "Erro de rede." });
      setTimeout(() => setUnlockFeedback(null), 4000);
    } finally {
      setUnlocking(false);
    }
  };

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        {/* Priority arrows */}
        <div className="flex shrink-0 flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined shrink-0 text-base text-text-muted">
          {authIcon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {secondaryDisplayName && (
            <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            <Badge variant="default" size="sm">
              {authLabel}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {isGoogleVerificationIssue && connection.isActive !== false && (
              <a
                href={effectiveValidationUrl || "https://myaccount.google.com/security-checkup"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
                title={effectiveValidationUrl ? "Abrir link oficial de liberação gerado pelo Google" : "Abrir verificação de segurança da sua conta Google"}
              >
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                {effectiveValidationUrl ? "Acessar Link de Liberação" : "Liberar Conta Google"}
              </a>
            )}
            {(isCooldown || connection.lastError || connection.testStatus === "unavailable") && connection.isActive !== false && (
              <button
                type="button"
                onClick={handleUnlock}
                disabled={unlocking}
                className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-400"
                title="Limpar bloqueios e cooldown desta conta imediatamente"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {unlocking ? "progress_activity" : "lock_open"}
                </span>
                {unlocking ? "Liberando..." : "Liberar Conta"}
              </button>
            )}
            {connection.lastError && connection.isActive !== false && (
              <button
                type="button"
                onClick={() => setShowErrorModal(true)}
                className="max-w-full truncate text-left text-xs text-red-500 underline decoration-red-500/40 underline-offset-2 hover:text-red-600 dark:hover:text-red-400 sm:max-w-[300px]"
                title="Clique para ver os detalhes completos e links de desbloqueio"
              >
                {connection.lastError}
              </button>
            )}
            {unlockFeedback && (
              <span className={`text-xs font-medium ${unlockFeedback.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {unlockFeedback.text}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} size="sm">
                {getOneByOneLabel()}
              </Badge>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {autoPing && (
            <Tooltip text={autoPingTooltip}>
              <button
                onClick={() => autoPing.onToggle(!autoPing.on)}
                className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${autoPing.on ? "text-primary" : "text-text-muted hover:text-primary"}`}
              >
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                <span className="text-[10px] leading-tight">Auto-ping</span>
              </button>
            </Tooltip>
          )}
          {(isCooldown || connection.lastError || connection.testStatus === "unavailable") && (
            <button
              onClick={handleUnlock}
              disabled={unlocking}
              className="flex flex-col items-center rounded px-2 py-1 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
              title="Liberar / Desbloquear Conta (Limpa cooldown e erros)"
            >
              <span className="material-symbols-outlined text-[18px]">
                {unlocking ? "progress_activity" : "lock_open"}
              </span>
              <span className="text-[10px] leading-tight">Liberar</span>
            </button>
          )}
          <button onClick={onEdit} className="flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button onClick={onDelete} className="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10">
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
        />
      </div>

      {showErrorModal && (
        <Modal
          isOpen={showErrorModal}
          onClose={() => setShowErrorModal(false)}
          title={`Detalhes do Erro (${displayName})`}
          size="lg"
        >
          <div className="space-y-4">
            {effectiveValidationUrl && (
              <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 shadow-sm">
                <div className="flex items-center gap-2 font-semibold text-primary">
                  <span className="material-symbols-outlined">verified_user</span>
                  <span>Link Oficial de Desbloqueio Gerado pelo Google</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                  O Google gerou este link exclusivo com o token da sua sessão para validar a conta ({displayName}). Abra no navegador logado com a conta para confirmar a liberação:
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={effectiveValidationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    Acessar Link de Liberação Google
                  </a>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={unlocking ? "progress_activity" : "lock_open"}
                    onClick={async () => {
                      await handleUnlock();
                      setShowErrorModal(false);
                    }}
                    disabled={unlocking}
                  >
                    {unlocking ? "Liberando..." : "Liberar Conta no 9Router"}
                  </Button>
                </div>
              </div>
            )}

            {isGoogleVerificationIssue && !effectiveValidationUrl && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined">security</span>
                  <span>Google Bloqueou por Verificação de Segurança (403)</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                  O Google pausou as chamadas desta conta até que você confirme a atividade recente. Acesse os links abaixo logado com <strong className="text-text-main">{connection.email || "sua conta Google"}</strong> para liberar:
                </p>
                <div className="mt-3 flex flex-col sm:flex-row flex-wrap gap-2">
                  <a
                    href="https://myaccount.google.com/security-checkup"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    1. Liberar no Google Security Checkup
                  </a>
                  <a
                    href="https://myaccount.google.com/notifications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-2 text-xs font-medium text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span className="material-symbols-outlined text-sm">notifications</span>
                    2. Ver Alertas de Notificação Google
                  </a>
                  <a
                    href="https://console.cloud.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-2 text-xs font-medium text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span className="material-symbols-outlined text-sm">cloud</span>
                    3. Aceitar Termos no Cloud Console
                  </a>
                  <a
                    href="https://accounts.google.com/b/0/DisplayUnlockCaptcha"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-2 text-xs font-medium text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span className="material-symbols-outlined text-sm">key</span>
                    4. Desbloquear Captcha Google
                  </a>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-text-muted">Mensagem Completa do Erro:</label>
              <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-3 font-mono text-xs text-red-500 dark:bg-white/5">
                {connection.lastErrorDetail || connection.lastError || "Nenhum detalhe de erro disponível."}
              </pre>
            </div>

            <div className="flex justify-between items-center gap-2 pt-2 border-t border-border">
              {(isCooldown || connection.lastError || connection.testStatus === "unavailable") && (
                <Button
                  variant="primary"
                  icon={unlocking ? "progress_activity" : "lock_open"}
                  onClick={async () => {
                    await handleUnlock();
                    setShowErrorModal(false);
                  }}
                  disabled={unlocking}
                >
                  {unlocking ? "Liberando..." : "Liberar Conta Agora"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setShowErrorModal(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onUnlock: PropTypes.func,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    on: PropTypes.bool,
    onToggle: PropTypes.func,
    provider: PropTypes.string,
  }),
};
