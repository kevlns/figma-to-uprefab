using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;
using Vant.System.UI;

namespace Kevlns.Editor.FigmaToUprefab
{
    public sealed class FigmaPrefabSourceManifest
    {
        [JsonProperty("prefab")]
        public FigmaPrefabInfo Prefab { get; set; }

        [JsonProperty("source")]
        public FigmaPrefabSource Source { get; set; }

        [JsonProperty("identifierTranslations")]
        public Dictionary<string, string> IdentifierTranslations { get; set; } = new Dictionary<string, string>(StringComparer.Ordinal);

        [JsonProperty("nodes")]
        public List<FigmaPrefabSourceManifestNode> Nodes { get; set; } = new List<FigmaPrefabSourceManifestNode>();

        [JsonProperty("assets")]
        public List<FigmaPrefabAsset> Assets { get; set; } = new List<FigmaPrefabAsset>();
    }

    public sealed class FigmaPrefabSourceManifestNode
    {
        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("figmaName")]
        public string FigmaName { get; set; }

        [JsonProperty("visible")]
        public bool Visible { get; set; } = true;

        [JsonProperty("parentFigmaNodeId")]
        public string ParentFigmaNodeId { get; set; }

        [JsonProperty("layout")]
        public FigmaPrefabLayout Layout { get; set; }

        [JsonProperty("components")]
        public Dictionary<string, object> Components { get; set; } = new Dictionary<string, object>();

        [JsonProperty("text")]
        public Dictionary<string, object> Text { get; set; } = new Dictionary<string, object>();

        [JsonProperty("rcg")]
        public FigmaPrefabRcg Rcg { get; set; }

        [JsonProperty("designPreviewCount")]
        public int? DesignPreviewCount { get; set; }
    }

    public sealed class FigmaPrefabLocalConfig
    {
        [JsonProperty("schemaVersion")]
        public int SchemaVersion { get; set; }

        // No figmaAccessToken: the token is resolved by the Node CLI only
        // (FIGMA_ACCESS_TOKEN or user secret). C# never sees a token.

        [JsonProperty("baseUiPrefab")]
        public string BaseUiPrefab { get; set; }

        [JsonProperty("textPrefab")]
        public string TextPrefab { get; set; }

        [JsonProperty("specialListPrefab")]
        public string SpecialListPrefab { get; set; }

        [JsonProperty("specialGridPrefab")]
        public string SpecialGridPrefab { get; set; }

        [JsonProperty("formalPrefabRoot")]
        public string FormalPrefabRoot { get; set; }

        [JsonProperty("formalSpriteRoot")]
        public string FormalSpriteRoot { get; set; }

        [JsonProperty("tagMappings")]
        public Dictionary<string, FigmaPrefabLocalTagMapping> TagMappings { get; set; } = new Dictionary<string, FigmaPrefabLocalTagMapping>(StringComparer.OrdinalIgnoreCase);
    }

    public sealed class FigmaPrefabLocalTagMapping
    {
        [JsonProperty("kind")]
        public string Kind { get; set; }

        [JsonProperty("unityType")]
        public string UnityType { get; set; }

        [JsonProperty("prefabPath")]
        public string PrefabPath { get; set; }
    }

    public sealed class FigmaPrefabApproximationOverlay
    {
        [JsonProperty("schemaVersion")]
        public int SchemaVersion { get; set; }

        [JsonProperty("root")]
        public FigmaPrefabOverlayRoot Root { get; set; }

        [JsonProperty("entries")]
        public List<FigmaPrefabOverlayEntry> Entries { get; set; } = new List<FigmaPrefabOverlayEntry>();
    }

    public sealed class FigmaPrefabOverlayRoot
    {
        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("prefabName")]
        public string PrefabName { get; set; }
    }

    public sealed class FigmaPrefabOverlayEntry
    {
        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("approximation")]
        public FigmaPrefabOverlayApproximation Approximation { get; set; }

        [JsonProperty("reason")]
        public string Reason { get; set; }
    }

    public sealed class FigmaPrefabOverlayApproximation
    {
        public string HorizontalConstraint { get; set; }
        public string VerticalConstraint { get; set; }
        public string Positioning { get; set; }
        public string Align { get; set; }
        public string WidthSizing { get; set; }
        public string HeightSizing { get; set; }
        public string Direction { get; set; }
        public string PrimaryAlign { get; set; }
        public string CounterAlign { get; set; }
        public float? Spacing { get; set; }
        public List<float> Padding { get; set; }
        public bool? SpaceBetween { get; set; }
    }

    public static class FigmaPrefabSourceManifestAdapter
    {
        private const string DefaultBaseUiPrefabPath = "Assets/Arts/Game/Prefabs/UI Common/ui_base.prefab";
        private const string DefaultTextPrefabPath = "Assets/Arts/Game/Prefabs/UI Common/ui_base_text.prefab";
        private const string DefaultSpecialListPrefabPath = "Assets/Arts/Game/Prefabs/UI Common/ui_base_scroll_list.prefab";
        private const string DefaultSpecialGridPrefabPath = "Assets/Arts/Game/Prefabs/UI Common/ui_base_scroll_grid.prefab";
        private const string DefaultFormalPrefabRoot = "Assets/Arts/Game/Prefabs/";
        private const string DefaultFormalSpriteRoot = "Assets/Arts/Game/Sprite/";

        public static FigmaPrefabConversionResult ConvertFromFile(string manifestPath)
        {
            return ConvertFromFile(manifestPath, null);
        }

        public static FigmaPrefabConversionResult ConvertFromFile(string manifestPath, string localConfigPath)
        {
            return ConvertFromFile(manifestPath, localConfigPath, null);
        }

        public static FigmaPrefabConversionResult ConvertFromFile(string manifestPath, string localConfigPath, string overlayPath)
        {
            try
            {
                var manifest = JsonConvert.DeserializeObject<FigmaPrefabSourceManifest>(File.ReadAllText(manifestPath));
                var localConfig = NormalizeLocalConfig(ReadLocalConfig(localConfigPath));
                var overlay = ReadApproximationOverlay(overlayPath);
                var overlayResult = new FigmaPrefabConversionResult();
                ApplyApproximationOverlay(manifest, overlay, overlayResult);
                if (overlayResult.HasErrors)
                {
                    return overlayResult;
                }

                var conversion = Convert(manifest, localConfig);
                if (overlayResult.Issues.Count > 0)
                {
                    conversion.Issues.InsertRange(0, overlayResult.Issues);
                }

                return conversion;
            }
            catch (Exception exception)
            {
                return CreateError("SOURCE_MANIFEST_READ_FAILED", exception.Message, null);
            }
        }

        public static FigmaPrefabConversionResult Convert(FigmaPrefabSourceManifest manifest, FigmaPrefabLocalConfig localConfig = null)
        {
            if (manifest == null)
            {
                return CreateError("SOURCE_MANIFEST_MISSING", "Source manifest is missing.", null);
            }

            if (manifest.Prefab == null)
            {
                return CreateError("SOURCE_MANIFEST_PREFAB_MISSING", "Source manifest prefab data is missing.", null);
            }

            localConfig = NormalizeLocalConfig(localConfig);
            if (localConfig != null && localConfig.SchemaVersion != 1)
            {
                return CreateError("LOCAL_CONFIG_SCHEMA_UNSUPPORTED", "Local Figma config schemaVersion must be 1.", null);
            }

            if (!string.IsNullOrWhiteSpace(localConfig?.BaseUiPrefab))
            {
                manifest.Prefab.VariantFrom = localConfig.BaseUiPrefab;
            }
            else if (string.IsNullOrWhiteSpace(manifest.Prefab.VariantFrom))
            {
                manifest.Prefab.VariantFrom = DefaultBaseUiPrefabPath;
            }

            if (manifest.Nodes == null || manifest.Nodes.Count == 0)
            {
                return CreateError("SOURCE_MANIFEST_NODES_MISSING", "Source manifest has no raw Figma nodes.", null);
            }

            var sourceNodes = new Dictionary<string, FigmaPrefabSourceNode>(StringComparer.Ordinal);
            var manifestNodes = new Dictionary<string, FigmaPrefabSourceManifestNode>(StringComparer.Ordinal);
            var result = new FigmaPrefabConversionResult();
            for (int i = 0; i < manifest.Nodes.Count; i++)
            {
                var manifestNode = manifest.Nodes[i];
                if (manifestNode == null || string.IsNullOrWhiteSpace(manifestNode.FigmaNodeId))
                {
                    AddError(result, "SOURCE_NODE_ID_MISSING", "Source manifest node is missing figmaNodeId.", null);
                    continue;
                }

                if (string.IsNullOrWhiteSpace(manifestNode.FigmaName))
                {
                    AddError(result, "SOURCE_NAME_UNVERIFIABLE", "Source manifest node is missing its raw Figma layer name.", manifestNode.FigmaNodeId);
                    continue;
                }

                if (IsGeneratedNode(manifestNode.FigmaName) && manifestNode.Layout?.Rect == null)
                {
                    AddError(result, "SOURCE_LAYOUT_RECT_MISSING", "Tagged source node must contain canonical layout.rect data.", manifestNode.FigmaNodeId);
                    continue;
                }

                if (sourceNodes.ContainsKey(manifestNode.FigmaNodeId))
                {
                    AddError(result, "SOURCE_NODE_ID_DUPLICATE", "Source manifest has duplicate figmaNodeId.", manifestNode.FigmaNodeId);
                    continue;
                }

                NormalizeLayout(manifestNode.Layout, result, manifestNode.FigmaNodeId);

                var components = manifestNode.Components == null
                    ? new Dictionary<string, object>()
                    : new Dictionary<string, object>(manifestNode.Components);
                if (manifestNode.Text != null && manifestNode.Text.Count > 0)
                {
                    components["text"] = ConvertTextConfigToUnityCoordinates(manifestNode.Text);
                }

                sourceNodes.Add(manifestNode.FigmaNodeId, new FigmaPrefabSourceNode
                {
                    FigmaNodeId = manifestNode.FigmaNodeId,
                    Name = manifestNode.FigmaName,
                    Visible = manifestNode.Visible,
                    Layout = manifestNode.Layout,
                    Components = components,
                    Rcg = manifestNode.Rcg
                });
                manifestNodes.Add(manifestNode.FigmaNodeId, manifestNode);
            }

            if (result.HasErrors)
            {
                return result;
            }

            FigmaPrefabSourceNode root = null;
            for (int i = 0; i < manifest.Nodes.Count; i++)
            {
                var manifestNode = manifest.Nodes[i];
                var sourceNode = sourceNodes[manifestNode.FigmaNodeId];
                if (string.IsNullOrWhiteSpace(manifestNode.ParentFigmaNodeId))
                {
                    if (root != null)
                    {
                        AddError(result, "SOURCE_ROOT_MULTIPLE", "Source manifest must have exactly one root node.", manifestNode.FigmaNodeId);
                    }
                    else
                    {
                        root = sourceNode;
                    }

                    continue;
                }

                if (!sourceNodes.TryGetValue(manifestNode.ParentFigmaNodeId, out var parent))
                {
                    AddError(result, "SOURCE_PARENT_MISSING", "Source manifest parent node is missing.", manifestNode.FigmaNodeId);
                    continue;
                }

                parent.Children.Add(sourceNode);
            }

            if (root == null)
            {
                AddError(result, "SOURCE_ROOT_MISSING", "Source manifest root node is missing.", null);
            }

            if (!string.IsNullOrWhiteSpace(manifest.Source?.FrameNodeId) &&
                !string.Equals(manifest.Source.FrameNodeId, root?.FigmaNodeId, StringComparison.Ordinal))
            {
                AddError(result, "SOURCE_FRAME_ROOT_MISMATCH", "Source frameNodeId does not match the manifest root node.", root?.FigmaNodeId);
            }

            if (result.HasErrors)
            {
                return result;
            }

            ValidateLayoutParentChains(manifest.Nodes, manifestNodes, result);
            if (result.HasErrors)
            {
                return result;
            }

            var conversion = FigmaPrefabConverter.Convert(new FigmaPrefabConversionRequest
            {
                Prefab = manifest.Prefab,
                Root = root,
                IdentifierTranslator = new FigmaPrefabIdentifierTranslator(manifest.IdentifierTranslations),
                RcgDefaults = ResolveRcgDefaults(manifest.Prefab.VariantFrom)
            });
            if (result.Issues.Count > 0)
            {
                conversion.Issues.InsertRange(0, result.Issues);
            }

            if (conversion.HasErrors)
            {
                return conversion;
            }

            conversion.Ir.Assets = manifest.Assets ?? new List<FigmaPrefabAsset>();
            ApplyLocalConfig(conversion, localConfig);
            BindNodeScopedAssets(conversion, manifestNodes);
            PreserveListPreviewCounts(conversion.Ir.Tree, manifestNodes);
            return conversion;
        }

        private static bool IsGeneratedNode(string figmaName)
        {
            return !string.IsNullOrWhiteSpace(figmaName) &&
                   Regex.IsMatch(figmaName, @"\[(?:root|node)(?::[^\]]+)?\]", RegexOptions.CultureInvariant);
        }

        private static void NormalizeLayout(
            FigmaPrefabLayout layout,
            FigmaPrefabConversionResult result,
            string figmaNodeId)
        {
            if (layout == null)
            {
                return;
            }

            layout.Constraints = layout.Constraints ?? new FigmaPrefabConstraints();
            layout.Constraints.Horizontal = NormalizeConstraint(layout.Constraints.Horizontal, true, result, figmaNodeId);
            layout.Constraints.Vertical = NormalizeConstraint(layout.Constraints.Vertical, false, result, figmaNodeId);
            layout.Positioning = NormalizeValue(layout.Positioning, "auto");
            if (!string.Equals(layout.Positioning, "auto", StringComparison.Ordinal) &&
                !string.Equals(layout.Positioning, "absolute", StringComparison.Ordinal))
            {
                AddWarning(result, "SOURCE_LAYOUT_POSITIONING_APPROXIMATED", $"Unsupported layout positioning '{layout.Positioning}' was approximated as Auto.", figmaNodeId);
                layout.Positioning = "auto";
            }

            layout.Align = NormalizeAlignment(layout.Align, "inherit");
            if (layout.Align != "inherit" && layout.Align != "stretch")
            {
                AddWarning(result, "SOURCE_AUTO_LAYOUT_CHILD_ALIGN_APPROXIMATED", $"Unsupported child alignment '{layout.Align}' was approximated as Inherit.", figmaNodeId);
                layout.Align = "inherit";
            }

            layout.Sizing = layout.Sizing ?? new FigmaPrefabSizing();
            layout.Sizing.Width = NormalizeValue(layout.Sizing.Width, "fixed");
            layout.Sizing.Height = NormalizeValue(layout.Sizing.Height, "fixed");
            layout.Sizing.Width = NormalizeSizing(layout.Sizing.Width, "width", result, figmaNodeId);
            layout.Sizing.Height = NormalizeSizing(layout.Sizing.Height, "height", result, figmaNodeId);
            if (layout.AutoLayout == null)
            {
                return;
            }

            layout.AutoLayout.Direction = NormalizeValue(layout.AutoLayout.Direction, null);
            layout.AutoLayout.PrimaryAlign = NormalizeAlignment(layout.AutoLayout.PrimaryAlign, "min");
            layout.AutoLayout.CounterAlign = NormalizeAlignment(layout.AutoLayout.CounterAlign, "min");
            layout.AutoLayout.Wrap = NormalizeValue(layout.AutoLayout.Wrap, "no_wrap");
            if (layout.AutoLayout.Direction != "horizontal" && layout.AutoLayout.Direction != "vertical")
            {
                AddWarning(result, "SOURCE_AUTO_LAYOUT_DIRECTION_APPROXIMATED", $"Auto Layout direction '{layout.AutoLayout.Direction}' will be inferred from child geometry.", figmaNodeId);
            }

            if (layout.AutoLayout.Wrap != "no_wrap")
            {
                AddWarning(result, "SOURCE_AUTO_LAYOUT_WRAP_APPROXIMATED", "Wrapped Auto Layout will be approximated as a single line or column.", figmaNodeId);
            }
        }

        private static string NormalizeConstraint(
            string value,
            bool horizontal,
            FigmaPrefabConversionResult result,
            string figmaNodeId)
        {
            string normalized = NormalizeValue(value, "min");
            if (normalized == "left" || normalized == "top")
            {
                return "min";
            }

            if (normalized == "right" || normalized == "bottom")
            {
                return "max";
            }

            if (normalized == "left_right" || normalized == "top_bottom")
            {
                return "stretch";
            }

            if (normalized == "min" || normalized == "center" || normalized == "max" ||
                normalized == "stretch" || normalized == "scale")
            {
                return normalized;
            }

            AddWarning(
                result,
                "SOURCE_LAYOUT_CONSTRAINT_APPROXIMATED",
                $"Unsupported {(horizontal ? "horizontal" : "vertical")} constraint '{value}' was approximated as Min.",
                figmaNodeId);
            return "min";
        }

        private static string NormalizeSizing(
            string value,
            string axis,
            FigmaPrefabConversionResult result,
            string figmaNodeId)
        {
            if (value == "fixed" || value == "hug" || value == "fill")
            {
                return value;
            }

            AddWarning(result, "SOURCE_AUTO_LAYOUT_SIZING_APPROXIMATED", $"Unsupported {axis} sizing '{value}' was approximated as Fixed.", figmaNodeId);
            return "fixed";
        }

        private static string NormalizeAlignment(string value, string fallback)
        {
            string normalized = NormalizeValue(value, fallback);
            if (normalized == "start")
            {
                return "min";
            }

            if (normalized == "end")
            {
                return "max";
            }

            if (normalized == "spacebetween")
            {
                return "space_between";
            }

            return normalized;
        }

        private static string NormalizeValue(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().ToLowerInvariant();
        }

        private static void ValidateLayoutParentChains(
            List<FigmaPrefabSourceManifestNode> nodes,
            Dictionary<string, FigmaPrefabSourceManifestNode> nodesById,
            FigmaPrefabConversionResult result)
        {
            for (int i = 0; i < nodes.Count; i++)
            {
                var node = nodes[i];
                if (node == null || !IsGeneratedNode(node.FigmaName) || string.IsNullOrWhiteSpace(node.ParentFigmaNodeId))
                {
                    continue;
                }

                string parentId = node.ParentFigmaNodeId;
                bool hasSkippedParent = false;
                while (!string.IsNullOrWhiteSpace(parentId) && nodesById.TryGetValue(parentId, out var parent))
                {
                    if (IsGeneratedNode(parent.FigmaName))
                    {
                        break;
                    }

                    hasSkippedParent = true;
                    if (parent.Layout?.AutoLayout != null || !UsesDefaultTopLeftConstraints(parent.Layout))
                    {
                        AddWarning(
                            result,
                            "SOURCE_LAYOUT_PARENT_APPROXIMATED",
                            "A tagged node skips an untagged responsive or Auto Layout parent; its absolute bounds will be flattened into the nearest generated parent.",
                            node.FigmaNodeId);
                        break;
                    }

                    parentId = parent.ParentFigmaNodeId;
                }

                if (hasSkippedParent && !UsesDefaultTopLeftConstraints(node.Layout))
                {
                    AddWarning(
                        result,
                        "SOURCE_LAYOUT_PARENT_APPROXIMATED",
                        "A tagged responsive node skips its containing frame; its constraints will be approximated in the nearest generated parent.",
                        node.FigmaNodeId);
                }
            }
        }

        private static bool UsesDefaultTopLeftConstraints(FigmaPrefabLayout layout)
        {
            return layout?.Constraints != null &&
                   string.Equals(layout.Constraints.Horizontal, "min", StringComparison.Ordinal) &&
                   string.Equals(layout.Constraints.Vertical, "min", StringComparison.Ordinal);
        }

        private static FigmaPrefabRcg ResolveRcgDefaults(string basePrefabPath)
        {
            if (string.IsNullOrWhiteSpace(basePrefabPath))
            {
                return null;
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(basePrefabPath);
            var generator = prefab != null ? prefab.GetComponent<ReferenceContainerGenerator>() : null;
            if (generator == null)
            {
                return null;
            }

            return new FigmaPrefabRcg
            {
                NamespaceName = generator.namespaceName,
                SkinName = generator.skinName,
                GeneratePath = generator.generatePath
            };
        }

        private static FigmaPrefabApproximationOverlay ReadApproximationOverlay(string overlayPath)
        {
            if (string.IsNullOrWhiteSpace(overlayPath))
            {
                return null;
            }

            if (!File.Exists(overlayPath))
            {
                // Overlays are optional per root.
                return null;
            }

            return JsonConvert.DeserializeObject<FigmaPrefabApproximationOverlay>(File.ReadAllText(overlayPath));
        }

        private static void ApplyApproximationOverlay(
            FigmaPrefabSourceManifest manifest,
            FigmaPrefabApproximationOverlay overlay,
            FigmaPrefabConversionResult result)
        {
            if (overlay == null || manifest == null || manifest.Nodes == null)
            {
                return;
            }

            if (overlay.SchemaVersion != 1)
            {
                AddError(result, "OVERLAY_SCHEMA_UNSUPPORTED", "Approximation overlay schemaVersion must be 1.", null);
                return;
            }

            var nodesById = new Dictionary<string, FigmaPrefabSourceManifestNode>(StringComparer.Ordinal);
            for (int i = 0; i < manifest.Nodes.Count; i++)
            {
                var node = manifest.Nodes[i];
                if (node == null || string.IsNullOrWhiteSpace(node.FigmaNodeId) || nodesById.ContainsKey(node.FigmaNodeId))
                {
                    continue;
                }

                nodesById[node.FigmaNodeId] = node;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var entries = overlay.Entries ?? new List<FigmaPrefabOverlayEntry>();
            for (int i = 0; i < entries.Count; i++)
            {
                var entry = entries[i];
                if (entry == null || string.IsNullOrWhiteSpace(entry.FigmaNodeId))
                {
                    AddError(result, "OVERLAY_ENTRY_ID_MISSING", "Overlay entry is missing figmaNodeId.", null);
                    continue;
                }

                if (!seen.Add(entry.FigmaNodeId))
                {
                    AddError(result, "OVERLAY_ENTRY_DUPLICATE", $"Duplicate overlay entry for {entry.FigmaNodeId}.", entry.FigmaNodeId);
                    continue;
                }

                if (string.IsNullOrWhiteSpace(entry.Reason))
                {
                    AddError(result, "OVERLAY_REASON_REQUIRED", "Every approximation overlay entry must carry a reason.", entry.FigmaNodeId);
                }

                if (!nodesById.TryGetValue(entry.FigmaNodeId, out var targetNode))
                {
                    AddError(result, "OVERLAY_NODE_NOT_IN_SOURCE", $"Overlay references {entry.FigmaNodeId} which is absent from the source manifest.", entry.FigmaNodeId);
                    continue;
                }

                if (entry.Approximation == null)
                {
                    AddError(result, "OVERLAY_APPROXIMATION_MISSING", "Overlay entry must declare an approximation block.", entry.FigmaNodeId);
                    continue;
                }

                var approximation = BuildOverlayApproximation(entry.Approximation, entry.FigmaNodeId, result);
                approximation.Reason = string.IsNullOrWhiteSpace(entry.Reason) ? null : entry.Reason;
                targetNode.Layout = targetNode.Layout ?? new FigmaPrefabLayout();
                targetNode.Layout.Approximation = approximation;
            }
        }

        private static FigmaPrefabLayoutApproximation BuildOverlayApproximation(
            FigmaPrefabOverlayApproximation source,
            string figmaNodeId,
            FigmaPrefabConversionResult result)
        {
            var approximation = new FigmaPrefabLayoutApproximation();
            approximation.HorizontalConstraint = ValidateApproximationValue(source.HorizontalConstraint, new[] { "min", "center", "max", "stretch", "scale" }, "horizontalConstraint", figmaNodeId, result);
            approximation.VerticalConstraint = ValidateApproximationValue(source.VerticalConstraint, new[] { "min", "center", "max", "stretch", "scale" }, "verticalConstraint", figmaNodeId, result);
            approximation.Positioning = ValidateApproximationValue(source.Positioning, new[] { "auto", "absolute" }, "positioning", figmaNodeId, result);
            approximation.Align = ValidateApproximationValue(source.Align, new[] { "inherit", "stretch", "min", "center", "max", "baseline" }, "align", figmaNodeId, result);
            approximation.WidthSizing = ValidateApproximationValue(source.WidthSizing, new[] { "fixed", "hug", "fill" }, "widthSizing", figmaNodeId, result);
            approximation.HeightSizing = ValidateApproximationValue(source.HeightSizing, new[] { "fixed", "hug", "fill" }, "heightSizing", figmaNodeId, result);
            approximation.Direction = ValidateApproximationValue(source.Direction, new[] { "horizontal", "vertical" }, "direction", figmaNodeId, result);
            approximation.PrimaryAlign = ValidateApproximationValue(source.PrimaryAlign, new[] { "min", "center", "max", "space_between" }, "primaryAlign", figmaNodeId, result);
            approximation.CounterAlign = ValidateApproximationValue(source.CounterAlign, new[] { "min", "center", "max", "baseline" }, "counterAlign", figmaNodeId, result);
            approximation.Spacing = source.Spacing;
            approximation.Padding = source.Padding;
            approximation.SpaceBetween = source.SpaceBetween;
            return approximation;
        }

        private static string ValidateApproximationValue(
            string value,
            string[] allowed,
            string field,
            string figmaNodeId,
            FigmaPrefabConversionResult result)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            string normalized = value.Trim().ToLowerInvariant();
            for (int i = 0; i < allowed.Length; i++)
            {
                if (string.Equals(normalized, allowed[i], StringComparison.Ordinal))
                {
                    return normalized;
                }
            }

            AddError(result, "OVERLAY_FIELD_VALUE_INVALID", $"Overlay {field} value '{value}' is not in the approximation whitelist.", figmaNodeId);
            return null;
        }

        private static FigmaPrefabLocalConfig ReadLocalConfig(string localConfigPath)
        {
            if (string.IsNullOrWhiteSpace(localConfigPath))
            {
                return null;
            }

            if (!File.Exists(localConfigPath))
            {
                throw new FileNotFoundException("Figma local config file was not found.", localConfigPath);
            }

            return JsonConvert.DeserializeObject<FigmaPrefabLocalConfig>(File.ReadAllText(localConfigPath));
        }

        private static void ApplyLocalConfig(FigmaPrefabConversionResult result, FigmaPrefabLocalConfig localConfig)
        {
            // Project paths come from the tracked config (written by the Node CLI); defaults match the Vant Client layout.
            FigmaPrefabBuilder.ProjectPaths.SpecialListPrefabPath = !string.IsNullOrWhiteSpace(localConfig?.SpecialListPrefab) ? localConfig.SpecialListPrefab : DefaultSpecialListPrefabPath;
            FigmaPrefabBuilder.ProjectPaths.SpecialGridPrefabPath = !string.IsNullOrWhiteSpace(localConfig?.SpecialGridPrefab) ? localConfig.SpecialGridPrefab : DefaultSpecialGridPrefabPath;
            FigmaPrefabBuilder.ProjectPaths.FormalPrefabRoot = !string.IsNullOrWhiteSpace(localConfig?.FormalPrefabRoot) ? localConfig.FormalPrefabRoot : DefaultFormalPrefabRoot;
            FigmaPrefabBuilder.ProjectPaths.FormalSpriteRoot = !string.IsNullOrWhiteSpace(localConfig?.FormalSpriteRoot) ? localConfig.FormalSpriteRoot : DefaultFormalSpriteRoot;

            var mappings = new Dictionary<string, FigmaPrefabLocalTagMapping>(StringComparer.OrdinalIgnoreCase)
            {
                {
                    "text",
                    new FigmaPrefabLocalTagMapping
                    {
                        Kind = "prefab",
                        PrefabPath = !string.IsNullOrWhiteSpace(localConfig?.TextPrefab) ? localConfig.TextPrefab : DefaultTextPrefabPath
                    }
                }
            };
            if (localConfig?.TagMappings != null)
            {
                foreach (var mapping in localConfig.TagMappings)
                {
                    mappings[mapping.Key] = mapping.Value;
                }
            }

            ApplyLocalConfig(result.Ir.Tree, mappings, result);
            UpdateReferenceTypes(result.Ir.Tree, result.Ir.Tree, result);
        }

        private static void ApplyLocalConfig(
            FigmaPrefabNode node,
            Dictionary<string, FigmaPrefabLocalTagMapping> mappings,
            FigmaPrefabConversionResult result)
        {
            if (node == null)
            {
                return;
            }

            var components = node.Tags?.Components;
            if (components != null)
            {
                for (int index = components.Count - 1; index >= 0; index--)
                {
                    string component = components[index];
                    if (!mappings.TryGetValue(component, out var mapping))
                    {
                        continue;
                    }

                    if (mapping == null || string.IsNullOrWhiteSpace(mapping.Kind))
                    {
                        AddError(result, "LOCAL_TAG_MAPPING_INVALID", "Configured tag mapping kind is missing.", node.FigmaNodeId);
                        continue;
                    }

                    if (string.Equals(component, "text", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(mapping.Kind, "prefab", StringComparison.OrdinalIgnoreCase))
                    {
                        AddError(result, "TEXT_TAG_MAPPING_MUST_BE_PREFAB", "Text tag mapping must use a prefab so text rendering remains available.", node.FigmaNodeId);
                        continue;
                    }

                    if (string.Equals(mapping.Kind, "component", StringComparison.OrdinalIgnoreCase))
                    {
                        if (string.IsNullOrWhiteSpace(mapping.UnityType))
                        {
                            AddError(result, "LOCAL_COMPONENT_TYPE_MISSING", "Configured component mapping is missing unityType.", node.FigmaNodeId);
                            continue;
                        }

                        if (!node.ConfiguredComponentTypeNames.Contains(mapping.UnityType))
                        {
                            node.ConfiguredComponentTypeNames.Add(mapping.UnityType);
                        }

                        components.RemoveAt(index);
                        continue;
                    }

                    if (string.Equals(mapping.Kind, "prefab", StringComparison.OrdinalIgnoreCase))
                    {
                        if (string.IsNullOrWhiteSpace(mapping.PrefabPath))
                        {
                            AddError(result, "LOCAL_PREFAB_PATH_MISSING", "Configured prefab mapping is missing prefabPath.", node.FigmaNodeId);
                            continue;
                        }

                        if (!string.IsNullOrWhiteSpace(node.ConfiguredPrefabPath) &&
                            !string.Equals(node.ConfiguredPrefabPath, mapping.PrefabPath, StringComparison.Ordinal))
                        {
                            AddError(result, "LOCAL_PREFAB_MAPPING_CONFLICT", "Node has more than one configured prefab mapping.", node.FigmaNodeId);
                            continue;
                        }

                        node.ConfiguredPrefabPath = mapping.PrefabPath;
                        components.RemoveAt(index);
                        continue;
                    }

                    AddError(result, "LOCAL_TAG_MAPPING_KIND_UNSUPPORTED", "Configured tag mapping kind must be component or prefab.", node.FigmaNodeId);
                }
            }

            for (int i = 0; i < node.Children.Count; i++)
            {
                ApplyLocalConfig(node.Children[i], mappings, result);
            }
        }

        private static void UpdateReferenceTypes(FigmaPrefabNode root, FigmaPrefabNode node, FigmaPrefabConversionResult result)
        {
            if (node == null)
            {
                return;
            }

            for (int i = 0; i < node.References.Count; i++)
            {
                var reference = node.References[i];
                var target = FindNodeByKey(root, reference.Key);
                if (target?.ConfiguredComponentTypeNames == null || target.ConfiguredComponentTypeNames.Count == 0)
                {
                    continue;
                }

                if (target.ConfiguredComponentTypeNames.Count != 1)
                {
                    AddError(result, "LOCAL_REFERENCE_COMPONENT_AMBIGUOUS", "Referenced node has multiple configured component types.", target.FigmaNodeId);
                    continue;
                }

                reference.TypeName = target.ConfiguredComponentTypeNames[0];
            }

            for (int i = 0; i < node.Children.Count; i++)
            {
                UpdateReferenceTypes(root, node.Children[i], result);
            }
        }

        private static FigmaPrefabNode FindNodeByKey(FigmaPrefabNode node, string key)
        {
            if (node == null)
            {
                return null;
            }

            if (string.Equals(node.Key, key, StringComparison.Ordinal))
            {
                return node;
            }

            for (int i = 0; i < node.Children.Count; i++)
            {
                var target = FindNodeByKey(node.Children[i], key);
                if (target != null)
                {
                    return target;
                }
            }

            return null;
        }

        private static FigmaPrefabLocalConfig NormalizeLocalConfig(FigmaPrefabLocalConfig localConfig)
        {
            if (localConfig == null || localConfig.TagMappings == null)
            {
                return localConfig;
            }

            var normalizedMappings = new Dictionary<string, FigmaPrefabLocalTagMapping>(StringComparer.OrdinalIgnoreCase);
            foreach (var mapping in localConfig.TagMappings)
            {
                normalizedMappings[mapping.Key] = mapping.Value;
            }

            localConfig.TagMappings = normalizedMappings;
            return localConfig;
        }

        public static bool TryWriteIr(FigmaPrefabConversionResult conversion, string irPath, out string error)
        {
            error = null;
            if (conversion == null || conversion.HasErrors || conversion.Ir == null)
            {
                error = "Conversion did not produce a valid IR.";
                return false;
            }

            try
            {
                string directory = Path.GetDirectoryName(irPath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(irPath, JsonConvert.SerializeObject(conversion.Ir, Formatting.Indented));
                return true;
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return false;
            }
        }

        private static Dictionary<string, object> ConvertTextConfigToUnityCoordinates(Dictionary<string, object> sourceText)
        {
            var text = new Dictionary<string, object>(sourceText);
            if (text.TryGetValue("rotation", out var rawRotation) && TryGetNumericRotation(rawRotation, out var figmaRotation))
            {
                // Figma angles are clockwise in its Y-down screen coordinates; Unity UI local Z is counter-clockwise.
                text["rotation"] = -figmaRotation;
            }

            return text;
        }

        private static bool TryGetNumericRotation(object rawRotation, out float rotation)
        {
            if (rawRotation is float floatValue)
            {
                rotation = floatValue;
                return true;
            }

            if (rawRotation is double doubleValue)
            {
                rotation = (float)doubleValue;
                return true;
            }

            if (rawRotation is decimal decimalValue)
            {
                rotation = (float)decimalValue;
                return true;
            }

            if (rawRotation is int intValue)
            {
                rotation = intValue;
                return true;
            }

            if (rawRotation is long longValue)
            {
                rotation = longValue;
                return true;
            }

            rotation = 0f;
            return false;
        }

        private static void BindNodeScopedAssets(
            FigmaPrefabConversionResult result,
            Dictionary<string, FigmaPrefabSourceManifestNode> manifestNodes)
        {
            var irNodes = new Dictionary<string, FigmaPrefabNode>(StringComparer.Ordinal);
            CollectIrNodes(result.Ir.Tree, irNodes);
            var assetNodeIds = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < result.Ir.Assets.Count; i++)
            {
                var asset = result.Ir.Assets[i];
                if (asset == null || string.IsNullOrWhiteSpace(asset.FigmaNodeId))
                {
                    AddError(result, "ASSET_NODE_ID_MISSING", "Exported bitmap is missing figmaNodeId.", null);
                    continue;
                }

                if (!assetNodeIds.Add(asset.FigmaNodeId))
                {
                    AddError(result, "ASSET_NODE_DUPLICATE", "More than one exported bitmap targets the same Figma node.", asset.FigmaNodeId);
                    continue;
                }

                if (!string.Equals(asset.ExportMode, "node", StringComparison.OrdinalIgnoreCase))
                {
                    AddError(result, "ASSET_EXPORT_MODE_INVALID", "Exported bitmap must use exportMode = node.", asset.FigmaNodeId);
                    continue;
                }

                if (asset.SharedAsset && string.IsNullOrWhiteSpace(asset.SourceAssetNodeId))
                {
                    AddError(result, "ASSET_SHARED_SOURCE_MISSING", "Shared bitmap is missing sourceAssetNodeId.", asset.FigmaNodeId);
                    continue;
                }

                if (!irNodes.TryGetValue(asset.FigmaNodeId, out var node))
                {
                    AddError(result, "ASSET_NODE_NOT_EXPORTED", "Bitmap target is not an exported IR node.", asset.FigmaNodeId);
                    continue;
                }

                if (!HasComponent(node, "image"))
                {
                    AddError(result, "ASSET_NODE_NOT_IMAGE", "Bitmap target must declare the image component.", asset.FigmaNodeId);
                    continue;
                }

                if (string.IsNullOrWhiteSpace(asset.Key))
                {
                    AddError(result, "ASSET_KEY_MISSING", "Exported bitmap is missing key.", asset.FigmaNodeId);
                    continue;
                }

                if (!manifestNodes.ContainsKey(asset.FigmaNodeId))
                {
                    AddError(result, "ASSET_SOURCE_NODE_MISSING", "Bitmap target is absent from the source manifest.", asset.FigmaNodeId);
                    continue;
                }

                if (!node.Components.TryGetValue("image", out var rawConfig) || !(rawConfig is Dictionary<string, object> imageConfig))
                {
                    imageConfig = new Dictionary<string, object>(StringComparer.Ordinal);
                    node.Components["image"] = imageConfig;
                }

                imageConfig["sprite"] = "asset:" + asset.Key;
            }
        }

        private static void PreserveListPreviewCounts(
            FigmaPrefabNode node,
            Dictionary<string, FigmaPrefabSourceManifestNode> manifestNodes)
        {
            if (node == null)
            {
                return;
            }

            if (manifestNodes.TryGetValue(node.FigmaNodeId, out var sourceNode) && sourceNode.DesignPreviewCount.HasValue)
            {
                node.Components["designPreviewCount"] = sourceNode.DesignPreviewCount.Value;
            }

            for (int i = 0; i < node.Children.Count; i++)
            {
                PreserveListPreviewCounts(node.Children[i], manifestNodes);
            }
        }

        private static void CollectIrNodes(FigmaPrefabNode node, Dictionary<string, FigmaPrefabNode> nodes)
        {
            if (node == null)
            {
                return;
            }

            if (!string.IsNullOrWhiteSpace(node.FigmaNodeId))
            {
                nodes[node.FigmaNodeId] = node;
            }

            for (int i = 0; i < node.Children.Count; i++)
            {
                CollectIrNodes(node.Children[i], nodes);
            }
        }

        private static bool HasComponent(FigmaPrefabNode node, string component)
        {
            var components = node?.Tags?.Components;
            if (components == null)
            {
                return false;
            }

            for (int i = 0; i < components.Count; i++)
            {
                if (string.Equals(components[i], component, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static FigmaPrefabConversionResult CreateError(string code, string message, string figmaNodeId)
        {
            var result = new FigmaPrefabConversionResult();
            AddError(result, code, message, figmaNodeId);
            return result;
        }

        private static void AddError(FigmaPrefabConversionResult result, string code, string message, string figmaNodeId)
        {
            result.Issues.Add(new FigmaPrefabConversionIssue
            {
                IsError = true,
                Code = code,
                Message = message,
                FigmaNodeId = figmaNodeId
            });
        }

        private static void AddWarning(FigmaPrefabConversionResult result, string code, string message, string figmaNodeId)
        {
            result.Issues.Add(new FigmaPrefabConversionIssue
            {
                IsError = false,
                Code = code,
                Message = message,
                FigmaNodeId = figmaNodeId
            });
        }
    }

    public sealed class FigmaPrefabLocalConfigValidationResult
    {
        public List<string> Errors { get; } = new List<string>();

        public bool IsValid => Errors.Count == 0;
    }

    public static class FigmaPrefabLocalConfigValidator
    {
        public static FigmaPrefabLocalConfigValidationResult ValidateMappingsFromFile(string configPath)
        {
            var result = new FigmaPrefabLocalConfigValidationResult();
            if (string.IsNullOrWhiteSpace(configPath) || !File.Exists(configPath))
            {
                result.Errors.Add("FIGMA_CONFIG_FILE_MISSING");
                return result;
            }

            try
            {
                var config = JsonConvert.DeserializeObject<FigmaPrefabLocalConfig>(File.ReadAllText(configPath));
                return ValidateMappings(config);
            }
            catch (Exception)
            {
                result.Errors.Add("FIGMA_CONFIG_JSON_INVALID");
                return result;
            }
        }

        public static FigmaPrefabLocalConfigValidationResult ValidateMappings(FigmaPrefabLocalConfig config)
        {
            var result = new FigmaPrefabLocalConfigValidationResult();
            if (config == null || config.SchemaVersion != 1)
            {
                result.Errors.Add("FIGMA_CONFIG_SCHEMA_UNSUPPORTED");
                return result;
            }

            if (!string.IsNullOrWhiteSpace(config.BaseUiPrefab))
            {
                ValidatePrefabPath(config.BaseUiPrefab, "FIGMA_CONFIG_BASE_UI_PREFAB_NOT_FOUND", result);
            }

            if (config.TagMappings == null)
            {
                return result;
            }

            foreach (var pair in config.TagMappings)
            {
                string tag = pair.Key;
                var mapping = pair.Value;
                if (string.IsNullOrWhiteSpace(tag) || mapping == null)
                {
                    result.Errors.Add("FIGMA_CONFIG_TAG_MAPPING_INVALID:" + tag);
                    continue;
                }

                if (string.Equals(mapping.Kind, "component", StringComparison.OrdinalIgnoreCase))
                {
                    if (string.Equals(tag, "text", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Errors.Add("FIGMA_CONFIG_TEXT_MAPPING_MUST_BE_PREFAB");
                        continue;
                    }

                    var componentType = FindComponentType(mapping.UnityType);
                    if (componentType == null || !typeof(Component).IsAssignableFrom(componentType) ||
                        componentType == typeof(Transform) || componentType == typeof(RectTransform))
                    {
                        result.Errors.Add("FIGMA_CONFIG_COMPONENT_TYPE_INVALID:" + tag);
                    }

                    continue;
                }

                if (string.Equals(mapping.Kind, "prefab", StringComparison.OrdinalIgnoreCase))
                {
                    ValidatePrefabPath(mapping.PrefabPath, "FIGMA_CONFIG_PREFAB_NOT_FOUND:" + tag, result);
                    continue;
                }

                result.Errors.Add("FIGMA_CONFIG_TAG_MAPPING_INVALID:" + tag);
            }

            return result;
        }

        private static void ValidatePrefabPath(string prefabPath, string errorCode, FigmaPrefabLocalConfigValidationResult result)
        {
            if (string.IsNullOrWhiteSpace(prefabPath) ||
                !prefabPath.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase) ||
                !prefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase) ||
                AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath) == null)
            {
                result.Errors.Add(errorCode);
            }
        }

        private static Type FindComponentType(string typeName)
        {
            if (string.IsNullOrWhiteSpace(typeName))
            {
                return null;
            }

            var type = Type.GetType(typeName, false);
            if (type != null)
            {
                return type;
            }

            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (int i = 0; i < assemblies.Length; i++)
            {
                try
                {
                    type = assemblies[i].GetType(typeName, false);
                }
                catch (ReflectionTypeLoadException)
                {
                    continue;
                }

                if (type != null)
                {
                    return type;
                }
            }

            return null;
        }
    }
}
