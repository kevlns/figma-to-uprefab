// Copyright © 2026 Vant <sl_kevln@163.com>
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Kevlns.Editor.FigmaToUprefab
{
    // 正式 Source 适配；复用项目已安装的官方 prefab 构建器。
    internal static class CanvasProjectionAdapter
    {
        static JObject request;
        static string reportPath;
        static int nodeCount;
        internal static void Run(string requestPath)
        {
            try
            {
                nodeCount = 0;
                reportPath = null;
                request = JObject.Parse(File.ReadAllText(requestPath));
                reportPath = request.Value<string>("reportPath");
                if (request.Value<int>("version") != 1) throw new Exception("Source 版本不支持");
                var output = request.Value<string>("outputDirectory");
                if (!output.StartsWith("Assets/VantUiProduction/_Staging/", StringComparison.Ordinal) || output.Contains("..")) throw new Exception("输出目录无效");
                Directory.CreateDirectory(output);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                var nodes = ((JArray)request["projection"]["nodes"]).Cast<JObject>().ToList();
                var root = nodes.Single(n => n["parentId"].Type == JTokenType.Null);
                var name = root.Value<string>("name");
                var basePath = output + "/Base.prefab";
                var tree = BuildNode(root, nodes, Matrix4x4.identity, null);
                var assets = new JArray();
                foreach (JObject a in request["assets"])
                {
                    var assetPath = a.Value<string>("path");
                    if (assetPath.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))
                        throw new Exception("此 Unity 转换器未声明 WebP 解码支持，请将资产转换为 PNG 后导入");
                    assets.Add(new JObject { ["key"] = a["id"], ["format"] = "png", ["figmaNodeId"] = a["id"], ["exportMode"] = "node", ["destPath"] = assetPath, ["import"] = new JObject { ["textureType"] = "Sprite" } });
                }
                var ir = new JObject { ["prefab"] = new JObject { ["name"] = name, ["createBase"] = true, ["variantFrom"] = basePath, ["stagingPath"] = output + "/" + name + ".prefab", ["domain"] = "vant-ui-production" }, ["assets"] = assets, ["tree"] = tree };
                ir["atlases"] = request["projection"]["atlases"]?.DeepClone() ?? new JArray();
                BindInstances(tree);
                var typed = ir.ToObject<FigmaPrefabIr>();
                File.WriteAllText(Path.ChangeExtension(reportPath, "ir.json"), JsonConvert.SerializeObject(typed, Formatting.Indented));
                var buildReport = FigmaPrefabBuilder.Build(typed, new FigmaPrefabBuildOptions { StrictMode = true, AllowTypeFallback = false });
                if (buildReport.HasErrors) throw new Exception(JsonConvert.SerializeObject(buildReport));
                AssetDatabase.SaveAssets();
                File.WriteAllText(reportPath, new JObject { ["status"] = "ok", ["atlases"] = JArray.FromObject(buildReport.Atlases), ["sourceHash"] = request["sourceHash"], ["prefabName"] = name, ["converter"] = typeof(FigmaPrefabBuilder).FullName, ["build"] = JObject.FromObject(buildReport), ["nodes"] = nodeCount }.ToString(Formatting.Indented));
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                var actual = e;
                if (!string.IsNullOrEmpty(reportPath)) File.WriteAllText(reportPath, new JObject { ["status"] = "error", ["sourceHash"] = request?["sourceHash"], ["error"] = actual.ToString() }.ToString(Formatting.Indented));
                Debug.LogException(actual);
                EditorApplication.Exit(1);
            }
        }
        static float F(JToken token) { return token.Value<float>(); }
        static Matrix4x4 Local(JObject n)
        {
            var l = n["layout"]; var t = n["transform"];
            var pivot = new Vector3(F(l["pivot"]["x"]) * F(l["width"]), -(1 - F(l["pivot"]["y"])) * F(l["height"]), 0);
            return Matrix4x4.Translate(new Vector3(F(l["x"]), -F(l["y"]), 0) + pivot) * Matrix4x4.Rotate(Quaternion.Euler(0, 0, -F(t["rotation"]))) * Matrix4x4.Scale(new Vector3(F(t["scaleX"]), F(t["scaleY"]), 1)) * Matrix4x4.Translate(-pivot);
        }
        static JObject BuildNode(JObject n, List<JObject> nodes, Matrix4x4 skipped, JObject referenceOwner)
        {
            var matrix = skipped * Local(n);
            var l = (JObject)n["layout"].DeepClone();
            var vx = matrix.GetColumn(0); var vy = matrix.GetColumn(1);
            var sx = new Vector2(vx.x, vx.y).magnitude; var sy = new Vector2(vy.x, vy.y).magnitude;
            if (Mathf.Abs(Vector2.Dot(new Vector2(vx.x, vx.y).normalized, new Vector2(vy.x, vy.y).normalized)) > 0.0001f) throw new Exception("透传层产生剪切变换，RectTransform 无法表示：" + n.Value<string>("id"));
            if (vx.x * vy.y - vx.y * vy.x < 0) sy = -sy;
            var p = new Vector3(F(l["pivot"]["x"]) * F(l["width"]), -(1 - F(l["pivot"]["y"])) * F(l["height"]), 0);
            var position = matrix.MultiplyPoint3x4(p);
            l["x"] = position.x - p.x; l["y"] = -(position.y - p.y);
            nodeCount++;
            var presentation = new JObject {
                ["pivotX"] = l["pivot"]["x"], ["pivotY"] = l["pivot"]["y"],
                ["rotation"] = Mathf.Atan2(vx.y, vx.x) * Mathf.Rad2Deg,
                ["scaleX"] = sx, ["scaleY"] = sy, ["typography"] = n["typography"],
                ["spriteKey"] = n["assetId"],
                ["text"] = n.Value<string>("kind") == "text" ? n.Value<string>("text") ?? "" : null
            };
            var tags = n["tags"]; var components = new JArray(); var config = new JObject(); var types = new JArray(); string prefab = null;
            foreach (var token in tags["components"])
            {
                var c = token.Value<string>(); var definition = request["projection"]["components"][c];
                if (definition.Value<string>("kind") == "prefab") { if (prefab != null) throw new Exception("节点只允许一个 prefab 映射"); prefab = definition.Value<string>("prefabPath"); }
                else if (definition.Value<string>("kind") == "component") types.Add(definition["unityType"]);
                else components.Add(c == "img" ? "image" : c);
                var values = (JObject)(tags["params"][c]?.DeepClone() ?? new JObject());
                if (c == "img") c = "image";
                if (c == "image" && n["assetId"] != null) values["sprite"] = "asset:" + n.Value<string>("assetId");
                if (c == "text" || c == "uitext") values["text"] = n.Value<string>("text") ?? "";
                if (c == "grid" || c == "sgrid") { values["maxRows"] = values["rows"]; values["maxColumns"] = values["columns"]; values.Remove("rows"); values.Remove("columns"); }
                config[c] = values;
            }
            if (tags.Value<bool?>("cell") == true) components.Add("item");
            var result = new JObject { ["presentation"] = presentation, ["name"] = n["name"], ["key"] = tags.Value<string>("ref") ?? n.Value<string>("id"), ["figmaNodeId"] = n["id"], ["visible"] = n["visible"], ["tags"] = new JObject { ["node"] = tags["category"], ["components"] = components }, ["layout"] = new JObject { ["rect"] = new JObject { ["x"] = l["x"], ["y"] = l["y"], ["w"] = l["width"], ["h"] = l["height"] }, ["constraints"] = l["constraints"].DeepClone(), ["sizing"] = new JObject { ["width"] = "fixed", ["height"] = "fixed" } }, ["components"] = config, ["configuredComponentTypeNames"] = types, ["children"] = new JArray(), ["references"] = new JArray() };
            if (prefab != null) result["configuredPrefabPath"] = prefab;
            var parentReferenceOwner = referenceOwner;
            if (components.Any(c => c.Value<string>() == "rcg")) { result["rcg"] = tags["params"]["rcg"]?.DeepClone() ?? new JObject(); referenceOwner = result; }
            if (tags["ref"] != null && parentReferenceOwner != null)
            {
                var c = tags["components"][0].Value<string>();
                var map = new Dictionary<string,string> { {"image","UnityEngine.UI.Image"},{"img","UnityEngine.UI.Image"},{"text","TMPro.TextMeshProUGUI"},{"uitext","UnityEngine.UI.Text"},{"button","UnityEngine.UI.Button"},{"toggle","UnityEngine.UI.Toggle"},{"slider","UnityEngine.UI.Slider"},{"input","TMPro.TMP_InputField"},{"list","Vant.System.UI.CachedListComponent"},{"slist","Vant.System.UI.CachedListComponent"},{"grid","Vant.System.UI.CachedGridComponent"},{"sgrid","Vant.System.UI.CachedGridComponent"} };
                var typeName = map.ContainsKey(c) ? map[c] : request["projection"]["components"][c].Value<string>("unityType") ?? "UnityEngine.GameObject";
                ((JArray)parentReferenceOwner["references"]).Add(new JObject { ["key"] = result["key"], ["type"] = "Object", ["typeName"] = typeName });
            }
            AddChildren(result, n.Value<string>("id"), nodes, Matrix4x4.identity, referenceOwner);
            return result;
        }
        static void AddChildren(JObject output, string parentId, List<JObject> nodes, Matrix4x4 skipped, JObject owner)
        {
            foreach (var child in nodes.Where(c => c.Value<string>("parentId") == parentId))
            {
                if (child.Value<bool?>("passThrough") == true) AddChildren(output, child.Value<string>("id"), nodes, skipped * Local(child), owner);
                else ((JArray)output["children"]).Add(BuildNode(child, nodes, skipped, owner));
            }
        }
        static void BindInstances(JObject node)
        {
            var binding = request["projection"]["prefabBindings"]?[node.Value<string>("figmaNodeId")];
            if (binding != null)
            {
                var path = AssetDatabase.GUIDToAssetPath(binding.Value<string>("guid"));
                if (!path.StartsWith("Assets/", StringComparison.Ordinal) || !path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                    throw new Exception("目标 Unity 工程中找不到组件 Prefab：" + binding.Value<string>("path"));
                node["configuredPrefabPath"] = path;
                node["instanceOverrides"] = node["children"];
                node["children"] = new JArray();
                return;
            }
            foreach (JObject child in node["children"]) BindInstances(child);
        }

    }
}
