export default {
  id: "zro",
  alias: "zro",
  display: {
    name: "ZRO (Moonmath)",
    icon: "nightlight",
    color: "#6366F1",
    textIcon: "ZRO",
    website: "https://zro.moonmath.ai",
    notice: {
      apiKeyUrl: "https://zro.moonmath.ai/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://zro.moonmath.ai/v1/chat/completions",
    validateUrl: "https://zro.moonmath.ai/v1/models",
  },
  models: [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "dolly1-security", name: "Dolly 1 Security" },
    { id: "dolly2-security", name: "Dolly 2 Security" },
    { id: "auto", name: "Auto (ZRO)" },
  ],
};
