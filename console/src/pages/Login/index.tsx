import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Checkbox, Form, Input, Modal, Spin, message as antMessage } from "antd";
import { useAppMessage } from "../../hooks/useAppMessage";
import {
  Github,
  Globe2,
  Languages,
  LockKeyhole,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { authApi, type PasswordResetGuideResponse } from "../../api/modules/auth";
import { setAuthToken, setHubMode } from "../../api/config";
import { useTheme } from "../../contexts/ThemeContext";
import { getPostLoginHref } from "../../utils/navigationMode";
import styles from "./index.module.less";

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [invitationEnabled, setInvitationEnabled] = useState(false);
  const [isHub, setIsHub] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState<{
    username: string;
    password: string;
    invite_code?: string;
  } | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetGuide, setResetGuide] = useState<PasswordResetGuideResponse | null>(null);
  const [resetGuideLoading, setResetGuideLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { message } = useAppMessage();
  const rawRedirect = searchParams.get("redirect") || "/chat";
  const redirect =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/chat";

  const finishNavigation = useCallback(
    (target: string) => {
      const osHref = getPostLoginHref(window.location.pathname, target);
      if (osHref) {
        window.location.replace(osHref);
        return;
      }
      navigate(target, { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    authApi
      .getStatus()
      .then((res) => {
        if (!res.enabled) {
          finishNavigation(redirect);
          return;
        }
        setHasUsers(res.has_users);
        setRegistrationEnabled(Boolean(res.registration_enabled));
        setIsHub(res.mode === "hub");
        setHubMode(res.mode === "hub");
        setInvitationEnabled(res.registration_mode === "invite");
        if (!res.has_users) {
          setIsRegister(true);
        }
      })
      .catch(() => {});
  }, [finishNavigation, redirect]);

  const submitCredentials = async (values: {
    username: string;
    password: string;
    invite_code?: string;
  }) => {
    setLoading(true);
    try {
      if (isRegister) {
        const res = await authApi.register(
          values.username,
          values.password,
          values.invite_code,
        );
        if (res.token) {
          setAuthToken(res.token);
          message.success(t("login.registerSuccess"));
          finishNavigation(redirect);
        }
      } else {
        const res = await authApi.login(values.username, values.password);
        if (res.token) {
          setAuthToken(res.token);
          finishNavigation(redirect);
        } else {
          message.info(t("login.authNotEnabled"));
          finishNavigation(redirect);
        }
      }
    } catch (err) {
      let errorMsg = t("login.failed");

      // Check if it's an Error object and use the backend message directly
      if (err instanceof Error) {
        // Use the backend message directly without complex parsing
        errorMsg = err.message;
      } else if (isRegister) {
        errorMsg = t("login.registerFailed");
      }

      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const onFinish = async (values: {
    username: string;
    password: string;
    invite_code?: string;
  }) => {
    if (isHub && !disclaimerAccepted) {
      setPendingCredentials(values);
      openTerms();
      return;
    }
    await submitCredentials(values);
  };

  const openTerms = () => {
    setTermsRead(false);
    setTermsOpen(true);
  };

  const acceptTerms = () => {
    if (!termsRead) {
      return;
    }
    setDisclaimerAccepted(true);
    setTermsOpen(false);
    if (pendingCredentials) {
      const credentials = pendingCredentials;
      setPendingCredentials(null);
      void submitCredentials(credentials);
    }
  };

  const cancelTerms = () => {
    setTermsOpen(false);
    setPendingCredentials(null);
  };

  const openForgotPassword = async () => {
    setForgotOpen(true);
    setResetGuideLoading(true);
    setCopied(false);
    try {
      const guide = await authApi.getPasswordResetGuide();
      setResetGuide(guide);
    } catch {
      // Fallback with generic instructions
      setResetGuide({
        cli_command: "aiarb auth reset-password",
        manual_method: {
          description: "Delete the auth file and restart the service to re-register.",
          file_path: "~/.aiarb.secret/auth.json",
          command: 'rm "~/.aiarb.secret/auth.json"',
        },
        platform: "unix",
      });
    } finally {
      setResetGuideLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      antMessage.success(t("login.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      antMessage.error(t("login.copyFailed"));
    }
  };

  const isChinese = (i18n.resolvedLanguage || i18n.language || "en").startsWith(
    "zh",
  );

  const switchHubLanguage = () => {
    const language = isChinese ? "en" : "zh";
    void i18n.changeLanguage(language);
    localStorage.setItem("language", language);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        padding: "24px 16px",
        background: isDark
          ? "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)"
          : "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
      }}
    >
      <div
        style={{
          width: 400,
          maxWidth: "100%",
          padding: 32,
          borderRadius: 12,
          background: "var(--app-surface)",
          boxShadow: "var(--app-shadow-md)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src={`${import.meta.env.BASE_URL}${
              isDark ? "logo-dark.svg" : "logo-light.svg"
            }`}
            alt="AIARB"
            style={{ height: 48, marginBottom: 12 }}
          />
          <h2 className={styles.loginTitle}>
            {t(isRegister ? "login.registerTitle" : "login.title")}
          </h2>
          {!hasUsers && (
            <p className={styles.loginHint}>{t("login.firstUserHint")}</p>
          )}
        </div>

        <Form
          layout="vertical"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: t("login.usernameRequired") }]}
          >
            <Input
              prefix={
                <UserRound
                  size={16}
                  style={{
                    color: "var(--app-text-tertiary)",
                  }}
                />
              }
              placeholder={t("login.usernamePlaceholder")}
              autoComplete="username"
              autoFocus
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t("login.passwordRequired") }]}
          >
            <Input.Password
              prefix={
                <LockKeyhole
                  size={16}
                  style={{
                    color: "var(--app-text-tertiary)",
                  }}
                />
              }
              placeholder={t("login.passwordPlaceholder")}
              autoComplete="current-password"
            />
          </Form.Item>

          {isRegister && hasUsers && invitationEnabled && (
            <Form.Item name="invite_code" rules={[{ required: true }]}>
              <Input
                autoComplete="off"
                maxLength={128}
                placeholder={t("login.invitationCode")}
              />
            </Form.Item>
          )}
          {isHub && (
            <div className={styles.hubDisclaimer}>
              <div className={styles.disclaimerHeading}>
                <ShieldAlert size={16} aria-hidden="true" />
                <span>{t("login.hubDisclaimerTitle")}</span>
              </div>
              <ul className={styles.disclaimerPoints}>
                {[1, 2, 3].map((point) => (
                  <li key={point}>{t(`login.hubDisclaimerPoint${point}`)}</li>
                ))}
              </ul>
              <Checkbox
                checked={disclaimerAccepted}
                aria-label={t("login.hubDisclaimerAccept")}
                onChange={(event) => {
                  if (event.target.checked) {
                    openTerms();
                    return;
                  }
                  setDisclaimerAccepted(false);
                }}
              />
              <span className={styles.consentText}>
                {t("login.hubDisclaimerAcceptPrefix")}
                <button type="button" onClick={openTerms}>
                  {t("login.hubTerms")}
                </button>
              </span>
            </div>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ height: 44, borderRadius: 8, fontWeight: 500 }}
            >
              {t(isRegister ? "login.register" : "login.submit")}
            </Button>
          </Form.Item>
        </Form>
        {hasUsers && registrationEnabled && (
          <Button
            type="link"
            block
            onClick={() => setIsRegister((current) => !current)}
            style={{ marginTop: 14 }}
          >
            {isRegister ? t("login.returnToSignIn") : t("login.createAccount")}
          </Button>
        )}
        {hasUsers && !isRegister && (
          <div className={styles.forgotPasswordRow}>
            <button
              type="button"
              className={styles.forgotPasswordLink}
              onClick={openForgotPassword}
            >
              {t("login.forgotPassword")}
            </button>
          </div>
        )}
        {isHub && (
          <nav className={styles.hubLinks} aria-label={t("login.hubLinks")}>
            <a
              href="https://github.com/agentscope-ai/AIARB"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={14} strokeWidth={1.8} aria-hidden="true" />
              GitHub
            </a>
            <span aria-hidden="true" />
            <a
              href="https://AIARB.agentscope.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe2 size={14} strokeWidth={1.8} aria-hidden="true" />
              {t("login.officialWebsite")}
            </a>
            <span aria-hidden="true" />
            <button
              type="button"
              aria-label={t("login.switchLanguage")}
              onClick={switchHubLanguage}
            >
              <Languages size={14} strokeWidth={1.8} aria-hidden="true" />
              {isChinese ? "English" : "简体中文"}
            </button>
          </nav>
        )}
      </div>
      {isHub && (
        <Modal
          className={styles.termsModal}
          open={termsOpen}
          title={t("login.hubTermsTitle")}
          onCancel={cancelTerms}
          footer={
            <Button type="primary" disabled={!termsRead} onClick={acceptTerms}>
              {t("login.hubTermsAgree")}
            </Button>
          }
          centered
          width={620}
          destroyOnHidden
        >
          <div
            className={styles.termsScroll}
            onScroll={(event) => {
              const target = event.currentTarget;
              const remaining =
                target.scrollHeight - target.scrollTop - target.clientHeight;
              if (remaining <= 4) {
                setTermsRead(true);
              }
            }}
          >
            <p className={styles.termsLead}>{t("login.hubTermsLead")}</p>
            {[1, 2, 3, 4, 5, 6].map((section) => (
              <section key={section}>
                <h3>{t(`login.hubTermsSection${section}Title`)}</h3>
                <p>{t(`login.hubTermsSection${section}Body`)}</p>
              </section>
            ))}
            <p className={styles.termsEnd}>{t("login.hubTermsEnd")}</p>
          </div>
          {!termsRead && (
            <p className={styles.scrollHint}>{t("login.hubTermsScrollHint")}</p>
          )}
        </Modal>
      )}
      <Modal
        open={forgotOpen}
        title={t("login.forgotPasswordTitle")}
        onCancel={() => setForgotOpen(false)}
        footer={
          <Button onClick={() => setForgotOpen(false)}>
            {t("login.forgotPasswordClose")}
          </Button>
        }
        centered
        width={520}
        destroyOnHidden
      >
        {resetGuideLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : resetGuide ? (
          <div className={styles.resetGuide}>
            <p className={styles.resetGuideDesc}>
              {t("login.forgotPasswordDesc")}
            </p>

            <div className={styles.resetSection}>
              <h4 className={styles.resetSectionTitle}>
                {t("login.resetMethodCli")}
              </h4>
              <p className={styles.resetSectionHint}>
                {t("login.resetMethodCliHint")}
              </p>
              <div className={styles.codeBlock}>
                <code>{resetGuide.cli_command}</code>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => copyToClipboard(resetGuide.cli_command)}
                >
                  {copied ? t("login.copied") : t("login.copy")}
                </button>
              </div>
            </div>

            <div className={styles.resetSection}>
              <h4 className={styles.resetSectionTitle}>
                {t("login.resetMethodManual")}
              </h4>
              <p className={styles.resetSectionHint}>
                {t("login.resetMethodManualHint")}
              </p>
              <div className={styles.codeBlock}>
                <code>{resetGuide.manual_method.command}</code>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() =>
                    copyToClipboard(resetGuide.manual_method.command)
                  }
                >
                  {copied ? t("login.copied") : t("login.copy")}
                </button>
              </div>
              <p className={styles.resetFilePath}>
                {t("login.authFilePath")}:{" "}
                <code>{resetGuide.manual_method.file_path}</code>
              </p>
            </div>

            <div className={styles.resetWarning}>
              {t("login.resetWarning")}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
