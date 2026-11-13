window.__ModuleLoader__.load({id:"dsh-studio-design",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// studios/design/src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply2,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// <define:STUDIO_PROJECT>
var define_STUDIO_PROJECT_default = { schemaVersion: 1, id: "design", name: "\u8BBE\u8BA1\u5DE5\u4F5C\u5BA4", icon: "\u2726", description: "MasterGo \u8BBE\u8BA1\u7A3F \xB7 Reborn \u7EC4\u4EF6 \xB7 \u9879\u76EE\u914D\u7F6E\u4E0E\u4EE3\u7801\u534F\u4F5C", order: 17, entry: "/studio-projects/design", capabilities: ["project-inspection", "component-mapping", "mastergo-mcp", "reborn-mcp", "dsh-session", "sandbox-preview"], compatibility: { host: "0.2.1-rc.2", runtime: "^0.5.0", worktable: "^0.6.0" }, tasks: [{ id: "generate", label: "\u5B9E\u73B0\u8BBE\u8BA1\u7A3F", description: "\u8BFB\u53D6\u6307\u5B9A\u8282\u70B9\u6216\u5F53\u524D\u9009\u533A\u5E76\u5B9E\u73B0\u9875\u9762", text: "\u3010\u4EFB\u52A1\u7C7B\u578B\uFF1A\u5B9E\u73B0\u8BBE\u8BA1\u7A3F\u3011\u8C03\u7528 design_workspace\uFF08task=generate\uFF09\uFF0C\u6309\u8FD4\u56DE\u7684\u5185\u7F6E\u63D0\u793A\u8BCD\u6267\u884C\u3002\u901A\u8FC7 MCP \u8BFB\u53D6\u6307\u5B9A\u8282\u70B9\u6216\u5F53\u524D\u9009\u533A\u5E76\u5B9E\u73B0\u9875\u9762\uFF0C\u4F7F\u7528\u539F\u59CB\u7D20\u6750\u4E0E\u8BED\u4E49\u5339\u914D\u7684\u7EC4\u4EF6\u3002" }, { id: "read", label: "\u67E5\u770B\u5F53\u524D\u9009\u533A", description: "\u53EA\u8BFB\u8282\u70B9\u7D20\u6750\u3001\u7EC4\u4EF6\u53D8\u4F53\u4E0E\u4EA4\u4E92\uFF0C\u4E0D\u6539\u4EE3\u7801", text: "\u3010\u4EFB\u52A1\u7C7B\u578B\uFF1A\u67E5\u770B\u5F53\u524D\u9009\u533A\u3011\u8C03\u7528 design_workspace\uFF08task=read\uFF09\uFF0C\u6309\u8FD4\u56DE\u7684\u5185\u7F6E\u63D0\u793A\u8BCD\u6267\u884C\u3002\u901A\u8FC7 MCP \u8BFB\u53D6\u6307\u5B9A\u8282\u70B9\u6216\u5F53\u524D\u9009\u533A\uFF0C\u8BF4\u660E\u771F\u5B9E\u7D20\u6750\u3001\u7EC4\u4EF6\u53D8\u4F53\u4E0E\u4EA4\u4E92\uFF0C\u6682\u4E0D\u4FEE\u6539\u4EE3\u7801\u3002" }, { id: "rules", label: "\u751F\u6210\u8BBE\u8BA1\u89C4\u5219", description: "\u6309\u5F53\u524D\u9879\u76EE\u5F52\u7EB3\u8BBE\u8BA1\u89C4\u5219\uFF0C\u65E0\u9700 MasterGo", text: "\u3010\u4EFB\u52A1\u7C7B\u578B\uFF1A\u751F\u6210\u8BBE\u8BA1\u89C4\u5219\u3011\u8C03\u7528 design_workspace\uFF08task=rules\uFF09\uFF0C\u6309\u8FD4\u56DE\u7684\u5185\u7F6E\u63D0\u793A\u8BCD\u6267\u884C\u3002\u6839\u636E\u5F53\u524D\u9879\u76EE\u751F\u6210\u6216\u66F4\u65B0\u8BBE\u8BA1\u89C4\u5219\uFF0C\u4FDD\u7559\u5DF2\u6709\u7EA6\u675F\u5E76\u6807\u6CE8\u6587\u4EF6\u4F9D\u636E\u3002" }, { id: "optimize", label: "\u4F18\u5316\u5BF9\u5E94\u8282\u70B9", description: "\u91CD\u65B0\u8BFB\u53D6\u8282\u70B9\u5E76\u6838\u5BF9\u3001\u4FEE\u6B63\u5DF2\u6709\u5B9E\u73B0", text: "\u3010\u4EFB\u52A1\u7C7B\u578B\uFF1A\u4F18\u5316\u5BF9\u5E94\u8282\u70B9\u3011\u8C03\u7528 design_workspace\uFF08task=optimize\uFF09\uFF0C\u6309\u8FD4\u56DE\u7684\u5185\u7F6E\u63D0\u793A\u8BCD\u6267\u884C\u3002\u4F18\u5316\u6307\u5B9A\u8282\u70B9\u6216\u5F53\u524D\u9009\u533A\uFF1A\u5148\u901A\u8FC7 MCP \u91CD\u65B0\u8BFB\u53D6\u8282\u70B9\u539F\u59CB\u7D20\u6750\u3001\u7EC4\u4EF6\u53D8\u4F53\u4E0E\u5E03\u5C40\uFF0C\u6838\u5BF9\u5DF2\u6709\u5B9E\u73B0\uFF0C\u4FEE\u6B63\u56FE\u6807\u3001\u7EC4\u4EF6\u53CA\u4EA4\u4E92\uFF0C\u5E76\u5B9E\u9645\u6D4B\u8BD5\u548C\u622A\u56FE\u5BF9\u7167\u3002" }] };

// packages/sdk/client.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function ProjectCard(props) {
  const { project, reportMeta } = props;
  const id = "studio-" + project.id;
  (0, import_react.useEffect)(() => {
    reportMeta?.({ id, name: project.name, icon: project.icon });
  }, [id, project, reportMeta]);
  const name = props.nameOverrides?.[id] ?? project.name;
  const icon = props.iconOverrides?.[id] ?? project.icon;
  if (props.hidden?.includes(id) || props.query && !name.toLocaleLowerCase().includes(props.query.toLocaleLowerCase())) return null;
  const position = props.order?.indexOf(id) ?? -1;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: "sp:relative sp:flex sp:h-[34px] sp:w-full sp:items-center sp:gap-1.5 sp:rounded-(--dsw-radius-md) sp:border-0 sp:bg-transparent sp:px-2 sp:text-left sp:text-sm sp:leading-5 sp:text-(--dsw-alias-label-primary) sp:cursor-pointer sp:hover:bg-(--dsw-alias-interactive-bg-hover) sp:data-[on=true]:bg-(--dsw-alias-interactive-bg-hover)",
      "data-worktable-project": id,
      "data-on": props.activeSplitId === id ? "true" : "false",
      style: { order: position < 0 ? 1e3 : position },
      title: project.description,
      onClick: () => {
        props.openSplit?.({ id, title: name, icon, top: null, main: [{ id: id + "-main", title: name, min: 300, content: { kind: "iframe", url: "/studio-projects/" + project.id, title: name } }], chatWidth: { default: 340, min: 260, max: 640 } });
        props.reportUsed?.(id);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sp:flex sp:w-4 sp:shrink-0 sp:items-center sp:justify-center", children: icon }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sp:min-w-0 sp:flex-1 sp:truncate", children: name })
      ]
    }
  );
}
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = '/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */\n@layer properties;\n@layer theme, utilities;\n@layer theme {\n  :root, :host {\n    --sp-spacing: 0.25rem;\n    --sp-text-xs: 0.75rem;\n    --sp-text-xs--line-height: calc(1 / 0.75);\n    --sp-text-sm: 0.875rem;\n    --sp-text-sm--line-height: calc(1.25 / 0.875);\n    --sp-radius-md: 0.375rem;\n  }\n}\n@layer utilities {\n  .sp\\:relative {\n    position: relative;\n  }\n  .sp\\:flex {\n    display: flex;\n  }\n  .sp\\:h-\\[34px\\] {\n    height: 34px;\n  }\n  .sp\\:w-4 {\n    width: calc(var(--sp-spacing) * 4);\n  }\n  .sp\\:w-full {\n    width: 100%;\n  }\n  .sp\\:min-w-0 {\n    min-width: 0px;\n  }\n  .sp\\:flex-1 {\n    flex: 1;\n  }\n  .sp\\:shrink-0 {\n    flex-shrink: 0;\n  }\n  .sp\\:cursor-pointer {\n    cursor: pointer;\n  }\n  .sp\\:items-center {\n    align-items: center;\n  }\n  .sp\\:justify-center {\n    justify-content: center;\n  }\n  .sp\\:gap-1\\.5 {\n    gap: calc(var(--sp-spacing) * 1.5);\n  }\n  .sp\\:truncate {\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n  .sp\\:rounded-\\(--dsw-radius-md\\) {\n    border-radius: var(--dsw-radius-md);\n  }\n  .sp\\:border-0 {\n    border-style: var(--tw-border-style);\n    border-width: 0px;\n  }\n  .sp\\:bg-transparent {\n    background-color: transparent;\n  }\n  .sp\\:px-2 {\n    padding-inline: calc(var(--sp-spacing) * 2);\n  }\n  .sp\\:text-left {\n    text-align: left;\n  }\n  .sp\\:text-sm {\n    font-size: var(--sp-text-sm);\n    line-height: var(--tw-leading, var(--sp-text-sm--line-height));\n  }\n  .sp\\:leading-5 {\n    --tw-leading: calc(var(--sp-spacing) * 5);\n    line-height: calc(var(--sp-spacing) * 5);\n  }\n  .sp\\:text-\\(--dsw-alias-label-primary\\) {\n    color: var(--dsw-alias-label-primary);\n  }\n  @media (hover: hover) {\n    .sp\\:hover\\:bg-\\(--dsw-alias-interactive-bg-hover\\):hover {\n      background-color: var(--dsw-alias-interactive-bg-hover);\n    }\n  }\n  .sp\\:data-\\[on\\=true\\]\\:bg-\\(--dsw-alias-interactive-bg-hover\\)[data-on="true"] {\n    background-color: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n@property --tw-border-style {\n  syntax: "*";\n  inherits: false;\n  initial-value: solid;\n}\n@property --tw-leading {\n  syntax: "*";\n  inherits: false;\n}\n@layer properties {\n  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {\n    *, ::before, ::after, ::backdrop {\n      --tw-border-style: solid;\n      --tw-leading: initial;\n    }\n  }\n}\n';
    document.head.appendChild(style);
    return () => style.remove();
  }, "\u5DE5\u4F5C\u5BA4\u9879\u76EE\uFF1A\u5361\u7247\u6837\u5F0F");
  const project = define_STUDIO_PROJECT_default;
  ctx.slots.inject("sidebar.worktable.project", () => ctx.slots.register({ name: "sidebar.worktable.project", id: "studio-" + project.id, order: 17, inject: () => ({ project }) }, ProjectCard), "\u5DE5\u4F5C\u5BA4\u9879\u76EE\uFF1A" + project.name);
}

// studios/design/src/workspace.ts
function currentWorkspace(sessions) {
  return currentContext(sessions).root;
}
function currentContext(sessions) {
  const rows = Object.entries(sessions.list.getSnapshot().byId).filter(([, row]) => (row.retainedBy.mainView ?? 0) > 0);
  if (rows.length !== 1 || !rows[0][1].cwd) throw new Error("\u8BF7\u5148\u5728 dsh \u5DE5\u4F5C\u533A\u6253\u5F00\u9879\u76EE\u4F1A\u8BDD");
  return { sessionId: rows[0][0], root: rows[0][1].cwd };
}

// studios/design/src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function StudioBadge({ useProjection, label }) {
  const state = useProjection("studioDesign");
  return state?.mentioned ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "data-studio-participant": "design", className: "sd:rounded-md sd:border sd:border-(--dsw-alias-border-primary,#e2e6ed) sd:px-2 sd:py-1 sd:text-xs sd:text-(--dsw-alias-label-secondary,#636e7d)", title: label, children: label }) : null;
}
function StudioRowMark({ sessionId, useSessions, label, icon }) {
  const included = useSessions((state) => state.byId[sessionId]?.projectionValues?.studioDesign?.mentioned === true);
  return included ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "data-studio-row": "design", title: label, className: "sd:inline-flex sd:items-center sd:text-xs", children: icon }) : null;
}
function StudioRowHover({ sessionId, useSessions, label }) {
  const included = useSessions((state) => state.byId[sessionId]?.projectionValues?.studioDesign?.mentioned === true);
  return included ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "sd:text-xs", children: label }) : null;
}
var inject = ["slots", "sessions"];
function apply2(ctx) {
  apply(ctx);
  const sessions = ctx.sessions;
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = '/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */\n@layer properties;\n@layer theme, utilities;\n@layer theme {\n  :root, :host {\n    --sd-spacing: 0.25rem;\n    --sd-text-xs: 0.75rem;\n    --sd-text-xs--line-height: calc(1 / 0.75);\n    --sd-text-sm: 0.875rem;\n    --sd-text-sm--line-height: calc(1.25 / 0.875);\n    --sd-radius-md: 0.375rem;\n  }\n}\n@layer utilities {\n  .sd\\:inline-flex {\n    display: inline-flex;\n  }\n  .sd\\:items-center {\n    align-items: center;\n  }\n  .sd\\:rounded-md {\n    border-radius: var(--sd-radius-md);\n  }\n  .sd\\:border {\n    border-style: var(--tw-border-style);\n    border-width: 1px;\n  }\n  .sd\\:border-\\(--dsw-alias-border-primary\\,\\#e2e6ed\\) {\n    border-color: var(--dsw-alias-border-primary,#e2e6ed);\n  }\n  .sd\\:px-2 {\n    padding-inline: calc(var(--sd-spacing) * 2);\n  }\n  .sd\\:py-1 {\n    padding-block: var(--sd-spacing);\n  }\n  .sd\\:text-xs {\n    font-size: var(--sd-text-xs);\n    line-height: var(--tw-leading, var(--sd-text-xs--line-height));\n  }\n  .sd\\:text-\\(--dsw-alias-label-secondary\\,\\#636e7d\\) {\n    color: var(--dsw-alias-label-secondary,#636e7d);\n  }\n}\n@property --tw-border-style {\n  syntax: "*";\n  inherits: false;\n  initial-value: solid;\n}\n@layer properties {\n  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {\n    *, ::before, ::after, ::backdrop {\n      --tw-border-style: solid;\n    }\n  }\n}\n';
    document.head.appendChild(style);
    return () => style.remove();
  }, "\u8BBE\u8BA1\u5DE5\u4F5C\u5BA4\uFF1A\u53C2\u4E0E\u6807\u8BB0\u6837\u5F0F");
  const slots = ctx.slots;
  slots.inject("conversation.session.header.actions", () => slots.register({ name: "conversation.session.header.actions", id: "studio-design-participation", order: 120, inject: () => ({ label: define_STUDIO_PROJECT_default.name }) }, StudioBadge), "\u8BBE\u8BA1\u5DE5\u4F5C\u5BA4\uFF1A\u53C2\u4E0E\u6807\u8BB0");
  for (const [name, component] of [["sidebar.session.row.leading", StudioRowMark], ["sidebar.session.row.hover", StudioRowHover]]) {
    slots.inject(name, () => slots.register({ name, id: "studio-design-participation", order: 30, inject: () => ({ label: define_STUDIO_PROJECT_default.name, icon: define_STUDIO_PROJECT_default.icon }) }, component), "\u8BBE\u8BA1\u5DE5\u4F5C\u5BA4\uFF1A\u5DE5\u4F5C\u533A\u4F1A\u8BDD\u6807\u8BB0");
  }
  ctx.effect(() => {
    let active = true, pending = false;
    const receive = async (event) => {
      if (!active || pending || event.origin !== location.origin || event.data?.type !== "dsh:design:directory-pick" || typeof event.data.requestId !== "string" || event.data.requestId.length > 64) return;
      const frame = [...document.querySelectorAll("iframe")].find((item) => item.contentWindow === event.source && new URL(item.src, location.href).pathname.replace(/\/$/, "") === "/studio-projects/design" && item.getClientRects().length > 0);
      if (!frame?.contentWindow) return;
      const source = frame.contentWindow, requestId = event.data.requestId;
      pending = true;
      try {
        const native = window.__DSH_DIRECTORY_PICKER__;
        let path;
        if (event.data.kind === "context") {
          let context = null;
          try {
            context = currentContext(sessions);
          } catch (error) {
          }
          source.postMessage({ type: "dsh:design:directory-result", requestId, context }, event.origin);
          return;
        }
        if (event.data.kind === "workspace") path = currentWorkspace(sessions);
        else if (native) path = await native.pick();
        else {
          const rpcId = crypto.randomUUID();
          const response = await fetch("/api/directoryPicker/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "client-request", rpcId, method: "directoryPicker/pick", payload: { args: {} } }) });
          const result = await response.json();
          if (!response.ok || result.rpcId !== rpcId || !result.result?.ok) throw new Error("\u6B64\u5BBF\u4E3B\u6682\u4E0D\u652F\u6301\u5F39\u51FA\u76EE\u5F55\u9009\u62E9\uFF0C\u8BF7\u586B\u5199\u7EDD\u5BF9\u8DEF\u5F84");
          path = result.result.value;
        }
        if (active && frame.isConnected && frame.contentWindow === source) source.postMessage({ type: "dsh:design:directory-result", requestId, path }, event.origin);
      } catch (error) {
        if (active && frame.isConnected) source.postMessage({ type: "dsh:design:directory-result", requestId, error: error instanceof Error ? error.message : "\u76EE\u5F55\u9009\u62E9\u5931\u8D25" }, event.origin);
      } finally {
        pending = false;
      }
    };
    window.addEventListener("message", receive);
    return () => {
      active = false;
      window.removeEventListener("message", receive);
    };
  }, "\u8BBE\u8BA1\u5DE5\u4F5C\u5BA4\uFF1A\u76EE\u5F55\u9009\u62E9\u6865\u63A5");
}
return module.exports;}});
