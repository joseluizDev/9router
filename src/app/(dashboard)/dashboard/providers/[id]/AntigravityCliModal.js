"use client";

import { Button, Input, Modal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import PropTypes from "prop-types";
import { useEffect, useState } from "react";

export default function AntigravityCliModal({ isOpen, onClose, onSuccess }) {
  const [authUrl, setAuthUrl] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("auth"); // auth | success
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    if (isOpen) {
      setCode("");
      setError(null);
      setStep("auth");
      fetchAuthUrl();
    }
  }, [isOpen]);

  const fetchAuthUrl = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/oauth/antigravity/cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-auth-url" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate auth URL");
      setAuthUrl(data.authUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!code.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/oauth/antigravity/cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exchange-and-save", code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete login");
      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Antigravity CLI Login" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {step === "auth" ? (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-1.5">
                  Passo 1: Abra a URL de Autorização Google
                </p>
                <p className="text-xs text-text-muted mb-2">
                  Faça login com a conta Google para gerar as credenciais CLI no servidor.
                </p>
                <div className="flex gap-2">
                  <Input value={authUrl || ""} readOnly className="flex-1 font-mono text-xs" />
                  <Button
                    variant="secondary"
                    icon={copied === "auth_url" ? "check" : "content_copy"}
                    onClick={() => copy(authUrl, "auth_url")}
                    disabled={!authUrl}
                  >
                    Copy
                  </Button>
                  <Button
                    variant="primary"
                    icon="open_in_new"
                    onClick={() => window.open(authUrl, "_blank")}
                    disabled={!authUrl}
                  >
                    Open
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-1.5">
                  Passo 2: Cole o Código de Autorização fornecido pelo Google
                </p>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="4/0A..."
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSubmit} fullWidth disabled={loading || !code.trim()}>
                {loading ? "Saving & Connecting..." : "Salvar e Conectar CLI"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth disabled={loading}>
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <span className="material-symbols-outlined text-4xl text-green-500 mb-2">check_circle</span>
            <h3 className="text-lg font-semibold text-text-main mb-1">CLI Conectado com Sucesso!</h3>
            <p className="text-xs text-text-muted mb-4">
              As credenciais Google ADC foram gravadas e importadas automaticamente.
            </p>
            <Button onClick={onClose} variant="primary" fullWidth>
              Fechar
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

AntigravityCliModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
