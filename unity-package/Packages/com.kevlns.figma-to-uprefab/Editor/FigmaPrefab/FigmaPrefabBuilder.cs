using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using Vant.System.UI;
using Object = UnityEngine.Object;

namespace Kevlns.Editor.FigmaToUprefab
{
    public static class FigmaPrefabBuilder
    {
        private const string AssetsPrefix = "Assets/";
        private const string PrefabExtension = ".prefab";
        private const string StagingPathSegment = "/_Staging/";
        private const string DefaultFormalPrefabRoot = "Assets/Arts/Game/Prefabs/";
        private const string DefaultFormalSpriteRoot = "Assets/Arts/Game/Sprite/";
        private const string RcgComponentTag = "rcg";
        private const string ListComponentTag = "list";
        private const string GridComponentTag = "grid";
        private const string SpecialListComponentTag = "slist";
        private const string SpecialGridComponentTag = "sgrid";
        private const string ItemComponentTag = "item";
        private const string NoteNodeType = "note";
        private const string ImageComponentTag = "image";
        private const string TextComponentTag = "text";
        private const string UiTextComponentTag = "uitext";
        private const string ButtonComponentTag = "button";
        private const string ToggleComponentTag = "toggle";
        private const string SliderComponentTag = "slider";
        private const string InputComponentTag = "input";
        private const string ObjectReferenceType = "Object";
        private const string AssetReferencePrefix = "asset:";
        private const string DefaultSpecialListPrefabPath = "Assets/Arts/Game/Prefabs/UI Common/ui_base_scroll_list.prefab";
        private const string DefaultSpecialGridPrefabPath = "Assets/Arts/Game/Prefabs/UI Common/ui_base_scroll_grid.prefab";
        private const string SpecialContentName = "Content";

        /// <summary>Project-configurable paths. Set via FigmaPrefabProjectPaths.Apply before building; defaults match the Vant Client layout.</summary>
        public static class ProjectPaths
        {
            public static string SpecialListPrefabPath = DefaultSpecialListPrefabPath;
            public static string SpecialGridPrefabPath = DefaultSpecialGridPrefabPath;
            public static string FormalPrefabRoot = DefaultFormalPrefabRoot;
            public static string FormalSpriteRoot = DefaultFormalSpriteRoot;

            public static void Reset()
            {
                SpecialListPrefabPath = DefaultSpecialListPrefabPath;
                SpecialGridPrefabPath = DefaultSpecialGridPrefabPath;
                FormalPrefabRoot = DefaultFormalPrefabRoot;
                FormalSpriteRoot = DefaultFormalSpriteRoot;
            }
        }
        private static readonly HashSet<string> SupportedComponentTags = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            RcgComponentTag,
            ListComponentTag,
            GridComponentTag,
            SpecialListComponentTag,
            SpecialGridComponentTag,
            ItemComponentTag,
            ImageComponentTag,
            TextComponentTag,
            UiTextComponentTag,
            ButtonComponentTag,
            ToggleComponentTag,
            SliderComponentTag,
            InputComponentTag
        };

        public static FigmaPrefabBuildReport BuildFromIr(string irPath)
        {
            return BuildFromIr(irPath, null);
        }

        public static FigmaPrefabBuildReport BuildFromIr(string irPath, FigmaPrefabBuildOptions options)
        {
            options = options ?? new FigmaPrefabBuildOptions();
            if (string.IsNullOrWhiteSpace(irPath))
            {
                var emptyPathReport = new FigmaPrefabBuildReport();
                emptyPathReport.AddError("IR_PATH_MISSING", "IR path is missing.");
                return emptyPathReport;
            }

            try
            {
                string json = File.ReadAllText(irPath);
                var ir = JsonConvert.DeserializeObject<FigmaPrefabIr>(json);
                return Build(ir, options);
            }
            catch (Exception e)
            {
                var report = new FigmaPrefabBuildReport();
                report.AddError("IR_READ_FAILED", $"Failed to read IR: {e.Message}", irPath);
                return report;
            }
        }

        public static FigmaPrefabBuildReport Build(FigmaPrefabIr ir, FigmaPrefabBuildOptions options = null)
        {
            options = options ?? new FigmaPrefabBuildOptions();
            var report = FigmaPrefabIrValidator.Validate(ir, options);
            ApplyReportPaths(ir, report);
            CollectAssetPaths(ir, report);

            if (report.HasErrors || options.DryRun)
            {
                return report;
            }

            if (!TryValidatePrefabPaths(report, options))
            {
                return report;
            }

            var basePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(report.BasePrefabPath);
            if (basePrefab == null)
            {
                report.AddError("BASE_PREFAB_NOT_FOUND", $"Base prefab not found: {report.BasePrefabPath}.", "prefab.variantFrom");
                return report;
            }

            GameObject instance = null;
            try
            {
                instance = PrefabUtility.InstantiatePrefab(basePrefab) as GameObject;
                if (instance == null)
                {
                    report.AddError("BASE_PREFAB_INSTANTIATE_FAILED", $"Failed to instantiate base prefab: {report.BasePrefabPath}.", "prefab.variantFrom");
                    return report;
                }

                var spriteMap = ImportAssets(ir, report);
                BuildPrefabInstance(ir.Tree, instance, spriteMap, report, options);
                if (report.HasErrors)
                {
                    return report;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(report.PrefabPath));

                bool success;
                PrefabUtility.SaveAsPrefabAsset(instance, report.PrefabPath, out success);
                if (!success)
                {
                    report.AddError("PREFAB_SAVE_FAILED", $"Failed to save prefab: {report.PrefabPath}.", "prefab.stagingPath");
                }
                else
                {
                    AssetDatabase.ImportAsset(report.PrefabPath);
                }

                return report;
            }
            finally
            {
                if (instance != null)
                {
                    Object.DestroyImmediate(instance);
                }
            }
        }

        private static void ApplyReportPaths(FigmaPrefabIr ir, FigmaPrefabBuildReport report)
        {
            if (ir?.Prefab == null)
            {
                return;
            }

            report.BasePrefabPath = NormalizeAssetPath(ir.Prefab.VariantFrom);
            report.PrefabPath = ResolvePrefabPath(ir.Prefab);
            if (!string.IsNullOrWhiteSpace(ir.Prefab.Domain) && !string.IsNullOrWhiteSpace(ir.Prefab.Name))
            {
                report.SuggestedPromotionPrefabPath = NormalizeAssetPath(
                    Path.Combine(ProjectPaths.FormalPrefabRoot, "UI", ir.Prefab.Domain, ir.Prefab.Name + PrefabExtension));
                report.SuggestedPromotionSpriteFolder = NormalizeAssetPath(
                    Path.Combine(ProjectPaths.FormalSpriteRoot, ir.Prefab.Domain));
            }
        }

        private static void CollectAssetPaths(FigmaPrefabIr ir, FigmaPrefabBuildReport report)
        {
            if (ir?.Assets == null)
            {
                return;
            }

            for (int i = 0; i < ir.Assets.Count; i++)
            {
                var asset = ir.Assets[i];
                if (!string.IsNullOrWhiteSpace(asset?.DestPath))
                {
                    report.AssetPaths.Add(NormalizeAssetPath(asset.DestPath));
                }
            }
        }

        private static bool TryValidatePrefabPaths(FigmaPrefabBuildReport report, FigmaPrefabBuildOptions options)
        {
            if (!IsAssetPath(report.BasePrefabPath) || !report.BasePrefabPath.EndsWith(PrefabExtension, StringComparison.OrdinalIgnoreCase))
            {
                report.AddError("BASE_PREFAB_PATH_INVALID", "Base prefab path must be an Assets/*.prefab path.", "prefab.variantFrom");
            }

            if (!IsAssetPath(report.PrefabPath) || !report.PrefabPath.EndsWith(PrefabExtension, StringComparison.OrdinalIgnoreCase))
            {
                report.AddError("STAGING_PREFAB_PATH_INVALID", "Staging prefab path must resolve to an Assets/*.prefab path.", "prefab.stagingPath");
            }
            else
            {
                ValidateStagingDestination(report);
            }

            if (!report.HasErrors && AssetDatabase.LoadAssetAtPath<GameObject>(report.PrefabPath) != null)
            {
                report.Overwritten = true;
                if (!options.OverwriteStaging)
                {
                    report.AddError("STAGING_PREFAB_EXISTS", $"Staging prefab already exists: {report.PrefabPath}.", "prefab.stagingPath");
                }
            }

            return !report.HasErrors;
        }

        private static void ValidateStagingDestination(FigmaPrefabBuildReport report)
        {
            if (!report.PrefabPath.Contains(StagingPathSegment))
            {
                report.AddError("STAGING_PATH_NOT_STAGING", "Prefab output must be inside a _Staging folder.", "prefab.stagingPath");
            }

            if (report.PrefabPath.StartsWith(ProjectPaths.FormalPrefabRoot, StringComparison.Ordinal) ||
                report.PrefabPath.StartsWith(ProjectPaths.FormalSpriteRoot, StringComparison.Ordinal))
            {
                report.AddError("STAGING_PATH_FORMAL_ROOT", "Phase 1 builder must not write to formal Prefabs or Sprite folders.", "prefab.stagingPath");
            }
        }

        private static void BuildPrefabInstance(
            FigmaPrefabNode rootNode,
            GameObject rootObject,
            Dictionary<string, Sprite> spriteMap,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options)
        {
            ClearChildren(rootObject.transform);
            var nodeMap = new Dictionary<FigmaPrefabNode, GameObject>();
            BuildNode(rootNode, rootObject.transform, rootObject, null, null, false, nodeMap, spriteMap, report);
            ApplyReferences(rootNode, nodeMap, report, options);
            SaveItemPrefabs(rootNode, report, nodeMap);
            ApplyReferences(rootNode, nodeMap, report, options);
            AssetDatabase.SaveAssets();
        }

        private static GameObject BuildNode(
            FigmaPrefabNode node,
            Transform parent,
            GameObject existingObject,
            FigmaPrefabRect parentRect,
            FigmaPrefabNode parentNode,
            bool isSpecialLayoutManagedChild,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap,
            Dictionary<string, Sprite> spriteMap,
            FigmaPrefabBuildReport report)
        {
            if (IsNoteNode(node))
            {
                return null;
            }

            var go = existingObject ?? CreateNodeObject(node, report);
            if (go == null)
            {
                return null;
            }

            go.name = GetNodeName(node);
            if (existingObject == null)
            {
                go.transform.SetParent(parent, false);
            }

            bool isRoot = existingObject != null;
            bool isAutoLayoutManagedChild = IsAutoLayoutManagedChild(parentNode, node);
            EnsureRectTransform(go, node, parentRect, isRoot, isSpecialLayoutManagedChild || isAutoLayoutManagedChild);
            AddTaggedComponents(go, node, report);
            ApplyComponentProperties(go, node, spriteMap, report);
            ApplyAutoLayout(go, node);
            ApplyParentLayoutParticipation(go, node, parentNode, isSpecialLayoutManagedChild);

            nodeMap[node] = go;

            var specialContent = PrepareSpecialContent(go, node, report);
            var children = node.Children;
            if (children != null)
            {
                var childParentRect = node.Layout?.Rect ?? parentRect;
                // Figma MCP exposes children in stacking order (background to foreground),
                // which is the inverse of the visible Figma Layers panel. Preserve that order
                // at every depth so Unity's hierarchy is the requested inverse panel order.
                for (int i = 0; i < children.Count; i++)
                {
                    bool isItem = HasComponent(children[i], ItemComponentTag);
                    Transform childParent = specialContent != null && isItem ? specialContent : go.transform;
                    BuildNode(
                        children[i],
                        childParent,
                        null,
                        childParentRect,
                        node,
                        specialContent != null && isItem,
                        nodeMap,
                        spriteMap,
                        report);
                }
            }

            ConfigureCachedContainer(go, node, nodeMap);
            go.SetActive(node.Visible);
            return go;
        }

        private static GameObject CreateNodeObject(FigmaPrefabNode node, FigmaPrefabBuildReport report)
        {
            if (!string.IsNullOrWhiteSpace(node.ConfiguredPrefabPath))
            {
                var configuredPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(node.ConfiguredPrefabPath);
                if (configuredPrefab == null)
                {
                    report.AddError("CONFIGURED_PREFAB_NOT_FOUND", $"Configured prefab was not found: {node.ConfiguredPrefabPath}.", node.Key);
                    return null;
                }

                return PrefabUtility.InstantiatePrefab(configuredPrefab) as GameObject;
            }

            string specialPrefabPath = GetSpecialPrefabPath(node);
            if (string.IsNullOrWhiteSpace(specialPrefabPath))
            {
                return new GameObject(GetNodeName(node), typeof(RectTransform));
            }

            var specialPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(specialPrefabPath);
            if (specialPrefab == null)
            {
                report.AddError("SPECIAL_SCROLL_PREFAB_MISSING", $"Special scroll prefab was not found: {specialPrefabPath}.", node.Key);
                return null;
            }

            return PrefabUtility.InstantiatePrefab(specialPrefab) as GameObject;
        }

        private static string GetSpecialPrefabPath(FigmaPrefabNode node)
        {
            if (HasComponent(node, SpecialListComponentTag))
            {
                return ProjectPaths.SpecialListPrefabPath;
            }

            if (HasComponent(node, SpecialGridComponentTag))
            {
                return ProjectPaths.SpecialGridPrefabPath;
            }

            return null;
        }

        private static Transform PrepareSpecialContent(GameObject go, FigmaPrefabNode node, FigmaPrefabBuildReport report)
        {
            if (string.IsNullOrWhiteSpace(GetSpecialPrefabPath(node)))
            {
                return null;
            }

            var content = GetSpecialContent(go, node);
            if (content == null)
            {
                report.AddError("SPECIAL_SCROLL_CONTENT_MISSING", "Special scroll prefab does not contain Viewport/Content.", node.Key);
                return null;
            }

            var cachedContainer = GetCachedContainer(go, node);
            if (cachedContainer == null)
            {
                report.AddError("SPECIAL_SCROLL_CONTAINER_MISSING", "Special scroll prefab does not contain the expected cached container component.", node.Key);
                return null;
            }

            if (cachedContainer.itemTemplate != null)
            {
                Object.DestroyImmediate(cachedContainer.itemTemplate);
                cachedContainer.itemTemplate = null;
            }

            ClearChildren(content);
            cachedContainer.container = content;
            return content;
        }

        private static Transform GetSpecialContent(GameObject go, FigmaPrefabNode node)
        {
            return string.IsNullOrWhiteSpace(GetSpecialPrefabPath(node)) || go == null
                ? null
                : go.transform.Find("Viewport/" + SpecialContentName);
        }

        private static string GetNodeName(FigmaPrefabNode node)
        {
            if (!string.IsNullOrWhiteSpace(node?.Name))
            {
                return node.Name;
            }

            return "FigmaNode";
        }

        private static void EnsureRectTransform(
            GameObject go,
            FigmaPrefabNode node,
            FigmaPrefabRect parentRect,
            bool isRoot,
            bool isLayoutManagedChild)
        {
            var rectTransform = go.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                rectTransform = go.AddComponent<RectTransform>();
            }

            var rect = node.Layout?.Rect;
            if (rect == null)
            {
                return;
            }

            rectTransform.sizeDelta = new Vector2(rect.Width, rect.Height);
            if (isRoot || isLayoutManagedChild)
            {
                return;
            }

            rectTransform.pivot = new Vector2(0f, 1f);
            float parentX = parentRect?.X ?? 0f;
            float parentY = parentRect?.Y ?? 0f;
            float parentWidth = parentRect?.Width ?? 0f;
            float parentHeight = parentRect?.Height ?? 0f;
            float left = rect.X - parentX;
            float top = rect.Y - parentY;
            float right = left + rect.Width;
            float bottom = top + rect.Height;
            var constraints = node.Layout?.Constraints;
            string horizontalConstraint = node.Layout?.Approximation?.HorizontalConstraint ?? constraints?.Horizontal;
            string verticalConstraint = node.Layout?.Approximation?.VerticalConstraint ?? constraints?.Vertical;
            Vector2 anchorMin = new Vector2(
                ResolveHorizontalAnchorMin(horizontalConstraint, left, parentWidth),
                ResolveVerticalAnchorMin(verticalConstraint, bottom, parentHeight));
            Vector2 anchorMax = new Vector2(
                ResolveHorizontalAnchorMax(horizontalConstraint, right, parentWidth),
                ResolveVerticalAnchorMax(verticalConstraint, top, parentHeight));
            rectTransform.anchorMin = anchorMin;
            rectTransform.anchorMax = anchorMax;
            rectTransform.offsetMin = new Vector2(
                left - anchorMin.x * parentWidth,
                parentHeight - bottom - anchorMin.y * parentHeight);
            rectTransform.offsetMax = new Vector2(
                right - anchorMax.x * parentWidth,
                parentHeight - top - anchorMax.y * parentHeight);
        }

        private static float ResolveHorizontalAnchorMin(string constraint, float left, float parentWidth)
        {
            string normalized = NormalizeConstraint(constraint);
            if (normalized == "center")
            {
                return 0.5f;
            }

            if (normalized == "max")
            {
                return 1f;
            }

            if (normalized == "scale")
            {
                return parentWidth > 0f ? left / parentWidth : 0f;
            }

            return 0f;
        }

        private static float ResolveHorizontalAnchorMax(string constraint, float right, float parentWidth)
        {
            string normalized = NormalizeConstraint(constraint);
            if (normalized == "center")
            {
                return 0.5f;
            }

            if (normalized == "max" || normalized == "stretch")
            {
                return 1f;
            }

            if (normalized == "scale")
            {
                return parentWidth > 0f ? right / parentWidth : 0f;
            }

            return 0f;
        }

        private static float ResolveVerticalAnchorMin(string constraint, float bottom, float parentHeight)
        {
            string normalized = NormalizeConstraint(constraint);
            if (normalized == "center")
            {
                return 0.5f;
            }

            if (normalized == "min")
            {
                return 1f;
            }

            if (normalized == "scale")
            {
                return parentHeight > 0f ? 1f - bottom / parentHeight : 1f;
            }

            return 0f;
        }

        private static float ResolveVerticalAnchorMax(string constraint, float top, float parentHeight)
        {
            string normalized = NormalizeConstraint(constraint);
            if (normalized == "center")
            {
                return 0.5f;
            }

            if (normalized == "min" || normalized == "stretch")
            {
                return 1f;
            }

            if (normalized == "scale")
            {
                return parentHeight > 0f ? 1f - top / parentHeight : 1f;
            }

            return 0f;
        }

        private static string NormalizeConstraint(string constraint)
        {
            string normalized = string.IsNullOrWhiteSpace(constraint) ? "min" : constraint.ToLowerInvariant();
            if (normalized == "min" || normalized == "center" || normalized == "max" ||
                normalized == "stretch" || normalized == "scale")
            {
                return normalized;
            }

            return "min";
        }

        private static string GetEffectivePositioning(FigmaPrefabNode node)
        {
            return node?.Layout?.Approximation?.Positioning ?? node?.Layout?.Positioning ?? "auto";
        }

        private static string GetEffectiveAlign(FigmaPrefabNode node)
        {
            return node?.Layout?.Approximation?.Align ?? node?.Layout?.Align ?? "inherit";
        }

        private static string GetEffectiveSizing(FigmaPrefabNode node, int axis)
        {
            if (axis == 0)
            {
                return node?.Layout?.Approximation?.WidthSizing ?? node?.Layout?.Sizing?.Width ?? "fixed";
            }

            return node?.Layout?.Approximation?.HeightSizing ?? node?.Layout?.Sizing?.Height ?? "fixed";
        }

        private static void AddTaggedComponents(GameObject go, FigmaPrefabNode node, FigmaPrefabBuildReport report)
        {
            WarnUnsupportedComponents(node, report);
            if (HasComponent(node, ImageComponentTag))
            {
                GetOrAdd<Image>(go);
            }

            if (HasComponent(node, TextComponentTag))
            {
                GetOrAdd<TextMeshProUGUI>(go);
            }

            if (HasComponent(node, UiTextComponentTag))
            {
                GetOrAdd<Text>(go);
            }

            if (HasComponent(node, ButtonComponentTag))
            {
                GetOrAdd<Button>(go);
            }

            if (HasComponent(node, ToggleComponentTag))
            {
                GetOrAdd<Toggle>(go);
            }

            if (HasComponent(node, SliderComponentTag))
            {
                GetOrAdd<Slider>(go);
            }

            if (HasComponent(node, InputComponentTag))
            {
                GetOrAdd<TMP_InputField>(go);
            }

            if (HasComponent(node, ListComponentTag))
            {
                GetOrAdd<CachedListComponent>(go);
            }

            if (HasComponent(node, GridComponentTag))
            {
                GetOrAdd<CachedGridComponent>(go);
            }

            if (HasComponent(node, RcgComponentTag) || node.Rcg != null)
            {
                var rcg = GetOrAdd<ReferenceContainerGenerator>(go);
                if (!string.IsNullOrWhiteSpace(node.Rcg?.NamespaceName))
                {
                    rcg.namespaceName = node.Rcg.NamespaceName;
                }

                if (!string.IsNullOrWhiteSpace(node.Rcg?.SkinName))
                {
                    rcg.skinName = node.Rcg.SkinName;
                }

                if (!string.IsNullOrWhiteSpace(node.Rcg?.GeneratePath))
                {
                    rcg.generatePath = node.Rcg.GeneratePath;
                }
            }

            AddConfiguredComponents(go, node, report);
        }

        private static void AddConfiguredComponents(GameObject go, FigmaPrefabNode node, FigmaPrefabBuildReport report)
        {
            var typeNames = node.ConfiguredComponentTypeNames;
            if (typeNames == null)
            {
                return;
            }

            for (int i = 0; i < typeNames.Count; i++)
            {
                string typeName = typeNames[i];
                var componentType = FindComponentType(typeName);
                if (componentType == null)
                {
                    report.AddError("CONFIGURED_COMPONENT_TYPE_NOT_FOUND", $"Configured component type was not found: {typeName}.", node.Key);
                    continue;
                }

                if (!typeof(Component).IsAssignableFrom(componentType) ||
                    componentType == typeof(Transform) ||
                    componentType == typeof(RectTransform))
                {
                    report.AddError("CONFIGURED_COMPONENT_TYPE_INVALID", $"Configured type must be an addable Unity Component: {typeName}.", node.Key);
                    continue;
                }

                if (go.GetComponent(componentType) != null)
                {
                    continue;
                }

                try
                {
                    go.AddComponent(componentType);
                }
                catch (Exception exception)
                {
                    report.AddError("CONFIGURED_COMPONENT_ADD_FAILED", $"Could not add configured component {typeName}: {exception.Message}", node.Key);
                }
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

        private static void WarnUnsupportedComponents(FigmaPrefabNode node, FigmaPrefabBuildReport report)
        {
            var components = node?.Tags?.Components;
            if (components == null)
            {
                return;
            }

            for (int i = 0; i < components.Count; i++)
            {
                string component = components[i];
                if (!SupportedComponentTags.Contains(component))
                {
                    report.AddWarning("COMPONENT_TAG_UNSUPPORTED", $"Component tag is not supported in MVP: {component}.", node.Key);
                }
            }
        }

        private static Dictionary<string, Sprite> ImportAssets(FigmaPrefabIr ir, FigmaPrefabBuildReport report)
        {
            var spriteMap = new Dictionary<string, Sprite>(StringComparer.Ordinal);
            if (ir?.Assets == null)
            {
                return spriteMap;
            }

            for (int i = 0; i < ir.Assets.Count; i++)
            {
                var asset = ir.Assets[i];
                if (asset == null || string.IsNullOrWhiteSpace(asset.Key) || string.IsNullOrWhiteSpace(asset.DestPath))
                {
                    continue;
                }

                string assetPath = NormalizeAssetPath(asset.DestPath);
                if (!File.Exists(assetPath))
                {
                    report.AddWarning("ASSET_FILE_MISSING", $"Asset file not found: {assetPath}.", $"assets[{i}].destPath");
                    continue;
                }

                AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport);
                var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
                if (importer != null && IsSpriteImport(asset))
                {
                    importer.textureType = TextureImporterType.Sprite;
                    importer.spriteImportMode = SpriteImportMode.Single;
                    importer.SaveAndReimport();
                }
                else if (IsSpriteImport(asset))
                {
                    report.AddWarning("ASSET_IMPORTER_NOT_FOUND", $"Texture importer was not found for asset: {assetPath}.", $"assets[{i}].destPath");
                }

                var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
                if (sprite != null)
                {
                    spriteMap[asset.Key] = sprite;
                }
                else if (IsSpriteImport(asset))
                {
                    report.AddWarning("ASSET_SPRITE_LOAD_FAILED", $"Sprite could not be loaded from asset: {assetPath}.", $"assets[{i}].destPath");
                }
            }

            return spriteMap;
        }

        private static bool IsSpriteImport(FigmaPrefabAsset asset)
        {
            return string.Equals(asset.Import?.TextureType, "Sprite", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(asset.Format, "png", StringComparison.OrdinalIgnoreCase);
        }

        private static void ApplyComponentProperties(
            GameObject go,
            FigmaPrefabNode node,
            Dictionary<string, Sprite> spriteMap,
            FigmaPrefabBuildReport report)
        {
            ApplyImageProperties(go, node, spriteMap, report);
            ApplyTextProperties(go, node);
        }

        private static void ApplyImageProperties(
            GameObject go,
            FigmaPrefabNode node,
            Dictionary<string, Sprite> spriteMap,
            FigmaPrefabBuildReport report)
        {
            var image = go.GetComponent<Image>();
            if (image == null)
            {
                return;
            }

            var imageConfig = GetComponentConfig(node, ImageComponentTag);
            if (imageConfig == null)
            {
                return;
            }

            string colorValue = imageConfig.Value<string>("color");
            if (!string.IsNullOrWhiteSpace(colorValue) && ColorUtility.TryParseHtmlString(colorValue, out var color))
            {
                image.color = color;
            }

            string spriteValue = imageConfig.Value<string>("sprite");
            if (string.IsNullOrWhiteSpace(spriteValue))
            {
                return;
            }

            if (!spriteValue.StartsWith(AssetReferencePrefix, StringComparison.Ordinal))
            {
                report.AddWarning("IMAGE_SPRITE_REFERENCE_UNSUPPORTED", $"Image sprite reference is not supported: {spriteValue}.", node.Key);
                return;
            }

            string assetAlias = spriteValue.Substring(AssetReferencePrefix.Length);
            if (spriteMap.TryGetValue(assetAlias, out var sprite))
            {
                image.sprite = sprite;
            }
            else
            {
                report.AddWarning("IMAGE_SPRITE_NOT_FOUND", $"Image sprite asset was not found: {assetAlias}.", node.Key);
            }
        }

        private static void ApplyTextProperties(GameObject go, FigmaPrefabNode node)
        {
            var textConfig = GetComponentConfig(node, TextComponentTag);
            var tmpText = go.GetComponent<TextMeshProUGUI>();
            if (tmpText != null && textConfig != null)
            {
                tmpText.text = ReadTextValue(textConfig, go.name);
                ApplyTextStyle(tmpText, textConfig);
                ApplyTextRotation(go.GetComponent<RectTransform>(), textConfig);
            }

            var uiTextConfig = GetComponentConfig(node, UiTextComponentTag);
            var uiText = go.GetComponent<Text>();
            if (uiText != null && uiTextConfig != null)
            {
                uiText.text = ReadTextValue(uiTextConfig, go.name);
                ApplyTextStyle(uiText, uiTextConfig);
                ApplyTextRotation(go.GetComponent<RectTransform>(), uiTextConfig);
            }
        }

        private static void ApplyTextStyle(Graphic text, JObject textConfig)
        {
            if (TryReadFloat(textConfig, "fontSize", out var fontSize) && fontSize > 0f)
            {
                if (text is TextMeshProUGUI tmpText)
                {
                    tmpText.fontSize = fontSize;
                }
                else if (text is Text uiText)
                {
                    uiText.fontSize = Mathf.RoundToInt(fontSize);
                }
            }

            string colorValue = textConfig.Value<string>("color");
            if (!string.IsNullOrWhiteSpace(colorValue) && ColorUtility.TryParseHtmlString(colorValue, out var color))
            {
                text.color = color;
            }

            if (text is TextMeshProUGUI tmpTextLayout)
            {
                tmpTextLayout.enableAutoSizing = false;
                tmpTextLayout.enableWordWrapping = false;
                tmpTextLayout.overflowMode = TextOverflowModes.Overflow;
                tmpTextLayout.margin = Vector4.zero;
                ApplyTmpTextAlignment(tmpTextLayout, textConfig);

                if (TryReadFloat(textConfig, "letterSpacing", out var letterSpacing))
                {
                    tmpTextLayout.characterSpacing = letterSpacing;
                }

                if (TryReadFloat(textConfig, "lineHeight", out var lineHeight) &&
                    TryReadFloat(textConfig, "fontSize", out var lineHeightFontSize))
                {
                    tmpTextLayout.lineSpacing = lineHeight - lineHeightFontSize;
                }
            }
        }

        private static void ApplyTmpTextAlignment(TextMeshProUGUI text, JObject textConfig)
        {
            string horizontal = textConfig.Value<string>("horizontalAlignment");
            string vertical = textConfig.Value<string>("verticalAlignment");
            if (string.IsNullOrWhiteSpace(horizontal) || string.IsNullOrWhiteSpace(vertical))
            {
                return;
            }

            horizontal = horizontal.ToUpperInvariant();
            vertical = vertical.ToUpperInvariant();
            if (vertical == "TOP")
            {
                if (horizontal == "LEFT")
                {
                    text.alignment = TextAlignmentOptions.TopLeft;
                }
                else if (horizontal == "CENTER")
                {
                    text.alignment = TextAlignmentOptions.Top;
                }
                else if (horizontal == "RIGHT")
                {
                    text.alignment = TextAlignmentOptions.TopRight;
                }
                else if (horizontal == "JUSTIFIED")
                {
                    text.alignment = TextAlignmentOptions.TopJustified;
                }
            }
            else if (vertical == "CENTER")
            {
                if (horizontal == "LEFT")
                {
                    text.alignment = TextAlignmentOptions.MidlineLeft;
                }
                else if (horizontal == "CENTER")
                {
                    text.alignment = TextAlignmentOptions.Midline;
                }
                else if (horizontal == "RIGHT")
                {
                    text.alignment = TextAlignmentOptions.MidlineRight;
                }
                else if (horizontal == "JUSTIFIED")
                {
                    text.alignment = TextAlignmentOptions.MidlineJustified;
                }
            }
            else if (vertical == "BOTTOM")
            {
                if (horizontal == "LEFT")
                {
                    text.alignment = TextAlignmentOptions.BottomLeft;
                }
                else if (horizontal == "CENTER")
                {
                    text.alignment = TextAlignmentOptions.Bottom;
                }
                else if (horizontal == "RIGHT")
                {
                    text.alignment = TextAlignmentOptions.BottomRight;
                }
                else if (horizontal == "JUSTIFIED")
                {
                    text.alignment = TextAlignmentOptions.BottomJustified;
                }
            }
        }

        private static void ApplyTextRotation(RectTransform rectTransform, JObject textConfig)
        {
            if (rectTransform == null || !TryReadFloat(textConfig, "rotation", out var figmaRotation))
            {
                return;
            }

            // Source manifests normalize Figma rotation from radians to clockwise degrees.
            rectTransform.localRotation = Quaternion.Euler(0f, 0f, figmaRotation);
        }

        private static bool TryReadFloat(JObject config, string propertyName, out float value)
        {
            value = 0f;
            var token = config?[propertyName];
            return token != null && float.TryParse(
                token.ToString(),
                global::System.Globalization.NumberStyles.Float,
                global::System.Globalization.CultureInfo.InvariantCulture,
                out value);
        }

        private static string ReadTextValue(JObject config, string fallback)
        {
            string text = config.Value<string>("text");
            if (!string.IsNullOrEmpty(text))
            {
                return text;
            }

            text = config.Value<string>("content");
            if (!string.IsNullOrEmpty(text))
            {
                return text;
            }

            text = config.Value<string>("value");
            return string.IsNullOrEmpty(text) ? fallback : text;
        }

        private static void ApplyAutoLayout(GameObject go, FigmaPrefabNode node)
        {
            if (IsCachedContainer(node))
            {
                return;
            }

            var autoLayout = node.Layout?.AutoLayout;
            if (autoLayout == null || string.IsNullOrWhiteSpace(autoLayout.Direction))
            {
                return;
            }

            bool isHorizontal = InferAutoLayoutHorizontal(node);

            RemoveBuiltInLayoutGroups(go);
            var layoutGroup = GetOrAdd<FigmaAutoLayoutGroup>(go);
            var approximation = node.Layout?.Approximation;
            string primaryAlign = approximation?.PrimaryAlign ?? autoLayout.PrimaryAlign;
            string counterAlign = approximation?.CounterAlign ?? autoLayout.CounterAlign;
            float spacing = approximation?.Spacing ?? autoLayout.Spacing;
            List<float> padding = approximation?.Padding ?? autoLayout.Padding;
            layoutGroup.Direction = isHorizontal
                ? FigmaAutoLayoutGroup.LayoutDirection.Horizontal
                : FigmaAutoLayoutGroup.LayoutDirection.Vertical;
            layoutGroup.MinimumSpacing = spacing;
            layoutGroup.SpaceBetween = approximation?.SpaceBetween ??
                                       (string.Equals(primaryAlign, "space_between", StringComparison.OrdinalIgnoreCase) &&
                                        !HasPrimaryAxisFillChild(node, isHorizontal));
            layoutGroup.padding = ToRectOffset(padding);
            layoutGroup.childAlignment = ToTextAnchor(primaryAlign, counterAlign, isHorizontal);
            layoutGroup.childControlWidth = true;
            layoutGroup.childControlHeight = true;
            layoutGroup.childForceExpandWidth = false;
            layoutGroup.childForceExpandHeight = false;
            layoutGroup.childScaleWidth = false;
            layoutGroup.childScaleHeight = false;
            ApplyContentSizeFitter(go, node);
        }

        private static void RemoveBuiltInLayoutGroups(GameObject go)
        {
            var layoutGroups = go.GetComponents<LayoutGroup>();
            for (int i = 0; i < layoutGroups.Length; i++)
            {
                if (layoutGroups[i] is FigmaAutoLayoutGroup)
                {
                    continue;
                }

                Object.DestroyImmediate(layoutGroups[i]);
            }
        }

        private static bool IsAutoLayoutManagedChild(FigmaPrefabNode parentNode, FigmaPrefabNode node)
        {
            return parentNode?.Layout?.AutoLayout != null &&
                   !string.Equals(GetEffectivePositioning(node), "absolute", StringComparison.OrdinalIgnoreCase);
        }

        private static bool InferAutoLayoutHorizontal(FigmaPrefabNode node)
        {
            string direction = node?.Layout?.Approximation?.Direction ?? node?.Layout?.AutoLayout?.Direction;
            if (string.Equals(direction, "horizontal", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (string.Equals(direction, "vertical", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var children = node?.Children;
            if (children == null || children.Count < 2)
            {
                return true;
            }

            bool hasCenter = false;
            float minX = float.MaxValue;
            float maxX = float.MinValue;
            float minY = float.MaxValue;
            float maxY = float.MinValue;
            for (int i = 0; i < children.Count; i++)
            {
                var child = children[i];
                if (string.Equals(GetEffectivePositioning(child), "absolute", StringComparison.OrdinalIgnoreCase) ||
                    child?.Layout?.Rect == null)
                {
                    continue;
                }

                hasCenter = true;
                float centerX = child.Layout.Rect.X + child.Layout.Rect.Width * 0.5f;
                float centerY = child.Layout.Rect.Y + child.Layout.Rect.Height * 0.5f;
                minX = Mathf.Min(minX, centerX);
                maxX = Mathf.Max(maxX, centerX);
                minY = Mathf.Min(minY, centerY);
                maxY = Mathf.Max(maxY, centerY);
            }

            return !hasCenter || maxX - minX >= maxY - minY;
        }

        private static bool HasPrimaryAxisFillChild(FigmaPrefabNode node, bool isHorizontal)
        {
            var children = node?.Children;
            if (children == null)
            {
                return false;
            }

            for (int i = 0; i < children.Count; i++)
            {
                var child = children[i];
                if (string.Equals(GetEffectivePositioning(child), "absolute", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string sizing = GetEffectiveSizing(child, isHorizontal ? 0 : 1);
                if (string.Equals(sizing, "fill", StringComparison.OrdinalIgnoreCase) || (child?.Layout?.Grow ?? 0f) > 0f)
                {
                    return true;
                }
            }

            return false;
        }

        private static void ApplyParentLayoutParticipation(
            GameObject go,
            FigmaPrefabNode node,
            FigmaPrefabNode parentNode,
            bool isSpecialLayoutManagedChild)
        {
            if (isSpecialLayoutManagedChild || parentNode?.Layout?.AutoLayout == null)
            {
                return;
            }

            var layoutElement = GetOrAdd<LayoutElement>(go);
            bool isAbsolute = string.Equals(GetEffectivePositioning(node), "absolute", StringComparison.OrdinalIgnoreCase);
            layoutElement.ignoreLayout = isAbsolute;
            if (isAbsolute)
            {
                return;
            }

            bool parentIsHorizontal = InferAutoLayoutHorizontal(parentNode);
            ConfigureLayoutElementAxis(layoutElement, node, 0, parentIsHorizontal);
            ConfigureLayoutElementAxis(layoutElement, node, 1, !parentIsHorizontal);
        }

        private static void ConfigureLayoutElementAxis(
            LayoutElement layoutElement,
            FigmaPrefabNode node,
            int axis,
            bool isPrimaryAxis)
        {
            string sizing = GetEffectiveSizing(node, axis);
            sizing = string.IsNullOrWhiteSpace(sizing) ? "fixed" : sizing.ToLowerInvariant();
            if (sizing != "fixed" && sizing != "hug" && sizing != "fill")
            {
                sizing = "fixed";
            }
            bool stretchOnCounterAxis = !isPrimaryAxis &&
                                        string.Equals(GetEffectiveAlign(node), "stretch", StringComparison.OrdinalIgnoreCase);
            bool fill = sizing == "fill" || stretchOnCounterAxis || (isPrimaryAxis && node.Layout != null && node.Layout.Grow > 0f);
            float preferredSize = axis == 0 ? node.Layout?.Rect?.Width ?? -1f : node.Layout?.Rect?.Height ?? -1f;
            float grow = node.Layout?.Grow ?? 0f;
            float flexibleSize = fill ? (grow > 0f ? grow : 1f) : 0f;

            if (axis == 0)
            {
                layoutElement.minWidth = -1f;
                layoutElement.preferredWidth = sizing == "fixed" ? preferredSize : -1f;
                layoutElement.flexibleWidth = flexibleSize;
                return;
            }

            layoutElement.minHeight = -1f;
            layoutElement.preferredHeight = sizing == "fixed" ? preferredSize : -1f;
            layoutElement.flexibleHeight = flexibleSize;
        }

        private static void ApplyContentSizeFitter(GameObject go, FigmaPrefabNode node)
        {
            if (node?.Layout?.Sizing == null && node?.Layout?.Approximation == null)
            {
                return;
            }

            bool hugWidth = string.Equals(GetEffectiveSizing(node, 0), "hug", StringComparison.OrdinalIgnoreCase);
            bool hugHeight = string.Equals(GetEffectiveSizing(node, 1), "hug", StringComparison.OrdinalIgnoreCase);
            if (!hugWidth && !hugHeight)
            {
                var existingFitter = go.GetComponent<ContentSizeFitter>();
                if (existingFitter != null)
                {
                    existingFitter.horizontalFit = ContentSizeFitter.FitMode.Unconstrained;
                    existingFitter.verticalFit = ContentSizeFitter.FitMode.Unconstrained;
                }

                return;
            }

            var fitter = GetOrAdd<ContentSizeFitter>(go);
            fitter.horizontalFit = hugWidth ? ContentSizeFitter.FitMode.PreferredSize : ContentSizeFitter.FitMode.Unconstrained;
            fitter.verticalFit = hugHeight ? ContentSizeFitter.FitMode.PreferredSize : ContentSizeFitter.FitMode.Unconstrained;
        }

        private static RectOffset ToRectOffset(List<float> padding)
        {
            if (padding == null || padding.Count < 4)
            {
                return new RectOffset();
            }

            return new RectOffset(
                Mathf.RoundToInt(padding[3]),
                Mathf.RoundToInt(padding[1]),
                Mathf.RoundToInt(padding[0]),
                Mathf.RoundToInt(padding[2]));
        }

        private static TextAnchor ToTextAnchor(string primaryAlign, string counterAlign, bool isHorizontal)
        {
            string primary = string.IsNullOrWhiteSpace(primaryAlign) ? "start" : primaryAlign.ToLowerInvariant();
            string counter = string.IsNullOrWhiteSpace(counterAlign) ? "start" : counterAlign.ToLowerInvariant();
            if (primary == "space_between")
            {
                primary = "min";
            }

            if (counter == "baseline")
            {
                counter = "min";
            }

            if (isHorizontal)
            {
                return ComposeTextAnchor(counter, primary);
            }

            return ComposeTextAnchor(primary, counter);
        }

        private static TextAnchor ComposeTextAnchor(string vertical, string horizontal)
        {
            bool top = vertical == "start" || vertical == "min";
            bool middle = vertical == "center" || vertical == "middle";
            bool bottom = vertical == "end" || vertical == "max";
            bool left = horizontal == "start" || horizontal == "min";
            bool center = horizontal == "center" || horizontal == "middle";
            bool right = horizontal == "end" || horizontal == "max";

            if (top && center)
            {
                return TextAnchor.UpperCenter;
            }

            if (top && right)
            {
                return TextAnchor.UpperRight;
            }

            if (middle && left)
            {
                return TextAnchor.MiddleLeft;
            }

            if (middle && center)
            {
                return TextAnchor.MiddleCenter;
            }

            if (middle && right)
            {
                return TextAnchor.MiddleRight;
            }

            if (bottom && left)
            {
                return TextAnchor.LowerLeft;
            }

            if (bottom && center)
            {
                return TextAnchor.LowerCenter;
            }

            if (bottom && right)
            {
                return TextAnchor.LowerRight;
            }

            return TextAnchor.UpperLeft;
        }

        private static JObject GetComponentConfig(FigmaPrefabNode node, string component)
        {
            if (node?.Components == null || !node.Components.TryGetValue(component, out var value) || value == null)
            {
                return null;
            }

            if (value is JObject jObject)
            {
                return jObject;
            }

            return JObject.FromObject(value);
        }

        private static void ConfigureCachedContainer(
            GameObject go,
            FigmaPrefabNode node,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap)
        {
            var cachedContainer = GetCachedContainer(go, node);
            if (cachedContainer == null)
            {
                return;
            }

            cachedContainer.container = GetSpecialContent(go, node) ?? go.transform;

            var itemNode = FindDirectItemChild(node);
            if (itemNode == null)
            {
                return;
            }

            if (nodeMap.TryGetValue(itemNode, out var itemObject))
            {
                cachedContainer.itemTemplate = itemObject;
                itemObject.SetActive(false);
                cachedContainer.poolSize = Math.Max(cachedContainer.poolSize, 1);
                cachedContainer.skinTypeName = BuildSkinTypeName(itemNode.Rcg);
            }

            ApplyCachedLayout(cachedContainer, node, itemNode);
        }

        private static void ApplyCachedLayout(CachedContainerBase cachedContainer, FigmaPrefabNode node, FigmaPrefabNode itemNode)
        {
            var autoLayout = node.Layout?.AutoLayout;
            if (cachedContainer is CachedListComponent list)
            {
                var listConfig = GetContainerConfig(node, ListComponentTag, SpecialListComponentTag);
                string direction = listConfig?.Value<string>("direction");
                if (autoLayout != null)
                {
                    list.spacing = node.Layout?.Approximation?.Spacing ?? autoLayout.Spacing;
                    list.padding = ToRectOffset(node.Layout?.Approximation?.Padding ?? autoLayout.Padding);
                    list.direction = InferAutoLayoutHorizontal(node)
                        ? CachedListDirection.Horizontal
                        : CachedListDirection.Vertical;
                }

                if (!string.IsNullOrWhiteSpace(direction))
                {
                    list.direction = IsHorizontalDirection(direction)
                        ? CachedListDirection.Horizontal
                        : CachedListDirection.Vertical;
                }

                if (itemNode?.Layout?.Rect != null)
                {
                    var rect = itemNode.Layout.Rect;
                    list.itemHeight = list.direction == CachedListDirection.Horizontal ? rect.Width : rect.Height;
                }

                SyncSpecialListScrollRect(cachedContainer, node, list.direction);

            }
            else if (cachedContainer is CachedGridComponent grid)
            {
                if (autoLayout != null)
                {
                    float spacing = node.Layout?.Approximation?.Spacing ?? autoLayout.Spacing;
                    grid.spacing = new Vector2(spacing, spacing);
                    grid.padding = ToRectOffset(node.Layout?.Approximation?.Padding ?? autoLayout.Padding);
                }

                if (itemNode?.Layout?.Rect != null)
                {
                    var rect = itemNode.Layout.Rect;
                    grid.cellSize = new Vector2(rect.Width, rect.Height);
                }

                var gridConfig = GetContainerConfig(node, GridComponentTag, SpecialGridComponentTag);
                if (TryReadInt(gridConfig, "maxRows", out var maxRows))
                {
                    grid.maxRows = maxRows;
                }

                if (TryReadInt(gridConfig, "maxColumns", out var maxColumns))
                {
                    grid.maxColumns = maxColumns;
                }
            }
        }

        private static void SyncSpecialListScrollRect(
            CachedContainerBase cachedContainer,
            FigmaPrefabNode node,
            CachedListDirection direction)
        {
            if (!HasComponent(node, SpecialListComponentTag))
            {
                return;
            }

            var scrollRect = cachedContainer == null
                ? null
                : cachedContainer.GetComponentInParent<ScrollRect>();
            if (scrollRect == null)
            {
                return;
            }

            bool isHorizontal = direction == CachedListDirection.Horizontal;
            scrollRect.horizontal = isHorizontal;
            scrollRect.vertical = !isHorizontal;
            if (scrollRect.horizontalScrollbar != null)
            {
                scrollRect.horizontalScrollbar.gameObject.SetActive(isHorizontal);
            }

            if (scrollRect.verticalScrollbar != null)
            {
                scrollRect.verticalScrollbar.gameObject.SetActive(!isHorizontal);
            }
        }

        private static JObject GetContainerConfig(FigmaPrefabNode node, string standardComponent, string specialComponent)
        {
            return GetComponentConfig(node, specialComponent) ?? GetComponentConfig(node, standardComponent);
        }

        private static bool TryReadInt(JObject config, string propertyName, out int value)
        {
            value = 0;
            var token = config?[propertyName];
            return token != null && int.TryParse(
                token.ToString(),
                global::System.Globalization.NumberStyles.Integer,
                global::System.Globalization.CultureInfo.InvariantCulture,
                out value);
        }

        private static bool IsHorizontalDirection(string direction)
        {
            return string.Equals(direction, "horizontal", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(direction, "HORIZONTAL", StringComparison.Ordinal);
        }

        private static string BuildSkinTypeName(FigmaPrefabRcg rcg)
        {
            if (rcg == null || string.IsNullOrWhiteSpace(rcg.SkinName))
            {
                return string.Empty;
            }

            if (string.IsNullOrWhiteSpace(rcg.NamespaceName))
            {
                return rcg.SkinName;
            }

            return rcg.NamespaceName + "." + rcg.SkinName;
        }

        private static void ApplyReferences(
            FigmaPrefabNode node,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options)
        {
            if (node == null || IsNoteNode(node))
            {
                return;
            }

            var go = !nodeMap.TryGetValue(node, out var mappedGo)
                ? null
                : mappedGo;
            var rcg = go != null ? go.GetComponent<ReferenceContainerGenerator>() : null;
            if (rcg != null)
            {
                rcg.references.Clear();
                var references = node.References;
                if (references != null)
                {
                    for (int i = 0; i < references.Count; i++)
                    {
                        AddReference(rcg, node, references[i], nodeMap, report, options);
                    }
                }
            }

            if (rcg != null)
            {
                EditorUtility.SetDirty(rcg);
            }

            var children = node.Children;
            if (children == null)
            {
                return;
            }

            for (int i = 0; i < children.Count; i++)
            {
                ApplyReferences(children[i], nodeMap, report, options);
            }
        }

        private static void AddReference(
            ReferenceContainerGenerator rcg,
            FigmaPrefabNode owner,
            FigmaPrefabReference reference,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options)
        {
            if (reference == null || !string.Equals(reference.Type, ObjectReferenceType, StringComparison.Ordinal))
            {
                return;
            }

            var targetNode = FindReferenceTarget(owner, reference.Key);
            if (targetNode == null || !nodeMap.TryGetValue(targetNode, out var targetGo))
            {
                return;
            }

            var referenceData = new ReferenceContainerGenerator.ReferenceData
            {
                alias = reference.Key,
                type = ReferenceContainerGenerator.ReferenceType.Object,
                typeName = reference.TypeName,
                objectValue = ResolveObjectReference(targetGo, targetNode, reference.TypeName, report, options)
            };

            rcg.references.Add(referenceData);
        }

        private static FigmaPrefabNode FindReferenceTarget(FigmaPrefabNode owner, string key)
        {
            if (owner == null || string.IsNullOrWhiteSpace(key))
            {
                return null;
            }

            if (string.Equals(owner.Key, key, StringComparison.Ordinal))
            {
                return owner;
            }

            return FindReferenceTargetInChildren(owner.Children, key);
        }

        private static FigmaPrefabNode FindReferenceTargetInChildren(List<FigmaPrefabNode> children, string key)
        {
            if (children == null)
            {
                return null;
            }

            for (int i = 0; i < children.Count; i++)
            {
                var child = children[i];
                if (child == null)
                {
                    continue;
                }

                if (string.Equals(child.Key, key, StringComparison.Ordinal))
                {
                    return child;
                }

                if (HasComponent(child, RcgComponentTag) || child.Rcg != null)
                {
                    continue;
                }

                var target = FindReferenceTargetInChildren(child.Children, key);
                if (target != null)
                {
                    return target;
                }
            }

            return null;
        }

        private static Object ResolveObjectReference(
            GameObject targetGo,
            FigmaPrefabNode targetNode,
            string typeName,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options)
        {
            if (string.IsNullOrWhiteSpace(typeName) || typeName == typeof(GameObject).FullName)
            {
                return targetGo;
            }

            var type = ResolveType(typeName);
            if (type != null && typeof(Component).IsAssignableFrom(type))
            {
                var component = targetGo.GetComponent(type);
                if (component == null && IsCachedContainer(targetNode))
                {
                    component = targetGo.GetComponentInChildren(type, true);
                }
                if (component != null)
                {
                    return component;
                }
            }

            if (options.AllowTypeFallback)
            {
                report.FallbackReferenceCount++;
                report.AddWarning("REFERENCE_TYPE_FALLBACK", $"Reference target fell back to GameObject because type was not found on target: {typeName}.");
                return targetGo;
            }

            report.AddError("REFERENCE_TYPE_RESOLVE_FAILED", $"Reference target type was not found on target: {typeName}.");
            return null;
        }

        private static void SaveItemPrefabs(
            FigmaPrefabNode node,
            FigmaPrefabBuildReport report,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap)
        {
            if (node == null || IsNoteNode(node))
            {
                return;
            }

            SaveDirectItemPrefab(node, report, nodeMap);

            var children = node.Children;
            if (children == null)
            {
                return;
            }

            for (int i = 0; i < children.Count; i++)
            {
                SaveItemPrefabs(children[i], report, nodeMap);
            }
        }

        private static void SaveDirectItemPrefab(
            FigmaPrefabNode containerNode,
            FigmaPrefabBuildReport report,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap)
        {
            if (!IsCachedContainer(containerNode))
            {
                return;
            }

            var itemNode = FindDirectItemChild(containerNode);
            if (itemNode == null)
            {
                return;
            }

            if (!nodeMap.TryGetValue(itemNode, out var itemObject) || itemObject == null || AssetDatabase.Contains(itemObject))
            {
                return;
            }

            string itemPrefabPath = ResolveItemPrefabPath(report, itemNode);
            Directory.CreateDirectory(Path.GetDirectoryName(itemPrefabPath));

            // Layout groups on list content can drive the template to transient zero/stretch sizes.
            // Detach and reapply the authoritative Figma rect before serializing the standalone prefab.
            itemObject.transform.SetParent(null, false);
            EnsureRectTransform(itemObject, itemNode, null, true, false);

            bool success;
            PrefabUtility.SaveAsPrefabAsset(itemObject, itemPrefabPath, out success);
            if (!success)
            {
                report.AddError("ITEM_PREFAB_SAVE_FAILED", $"Failed to save item prefab: {itemPrefabPath}.", itemNode.Key);
                return;
            }

            var itemPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(itemPrefabPath);
            if (itemPrefab == null)
            {
                report.AddError("ITEM_PREFAB_LOAD_FAILED", $"Failed to load item prefab after save: {itemPrefabPath}.", itemNode.Key);
                return;
            }

            if (!report.ItemPrefabPaths.Contains(itemPrefabPath))
            {
                report.ItemPrefabPaths.Add(itemPrefabPath);
            }

            MapPrefabSubtreeNodes(itemNode, itemPrefab, nodeMap);
            AssignItemTemplate(containerNode, itemPrefab, nodeMap);
            Object.DestroyImmediate(itemObject);
            AssetDatabase.ImportAsset(itemPrefabPath);
        }

        private static string ResolveItemPrefabPath(FigmaPrefabBuildReport report, FigmaPrefabNode itemNode)
        {
            string directory = Path.GetDirectoryName(report.PrefabPath);
            string itemName = itemNode.Rcg?.SkinName;
            if (!string.IsNullOrWhiteSpace(itemName) && itemName.EndsWith("Skin", StringComparison.Ordinal))
            {
                itemName = itemName.Substring(0, itemName.Length - "Skin".Length);
            }

            if (string.IsNullOrWhiteSpace(itemName))
            {
                itemName = string.IsNullOrWhiteSpace(itemNode.Key) ? GetNodeName(itemNode) : itemNode.Key;
            }

            return NormalizeAssetPath(Path.Combine(directory, itemName + PrefabExtension));
        }

        private static void MapPrefabSubtreeNodes(
            FigmaPrefabNode node,
            GameObject prefabObject,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap)
        {
            if (node == null || prefabObject == null)
            {
                return;
            }

            nodeMap[node] = prefabObject;

            var children = node.Children;
            if (children == null)
            {
                return;
            }

            for (int i = 0; i < children.Count; i++)
            {
                var child = children[i];
                var childTransform = prefabObject.transform.Find(GetNodeName(child));
                if (childTransform != null)
                {
                    MapPrefabSubtreeNodes(child, childTransform.gameObject, nodeMap);
                }
            }
        }

        private static void AssignItemTemplate(
            FigmaPrefabNode containerNode,
            GameObject itemPrefab,
            Dictionary<FigmaPrefabNode, GameObject> nodeMap)
        {
            if (!nodeMap.TryGetValue(containerNode, out var containerObject))
            {
                return;
            }

            var cachedContainer = GetCachedContainer(containerObject, containerNode);
            if (cachedContainer == null)
            {
                return;
            }

            cachedContainer.itemTemplate = itemPrefab;
            EditorUtility.SetDirty(cachedContainer);
        }

        private static Type ResolveType(string typeName)
        {
            var type = Type.GetType(typeName);
            if (type != null)
            {
                return type;
            }

            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (int i = 0; i < assemblies.Length; i++)
            {
                type = assemblies[i].GetType(typeName);
                if (type != null)
                {
                    return type;
                }
            }

            return null;
        }

        private static T GetOrAdd<T>(GameObject go) where T : Component
        {
            var component = go.GetComponent<T>();
            if (component == null)
            {
                component = go.AddComponent<T>();
            }

            return component;
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

        private static bool IsCachedContainer(FigmaPrefabNode node)
        {
            return HasComponent(node, ListComponentTag) ||
                   HasComponent(node, GridComponentTag) ||
                   HasComponent(node, SpecialListComponentTag) ||
                   HasComponent(node, SpecialGridComponentTag);
        }

        private static CachedContainerBase GetCachedContainer(GameObject go, FigmaPrefabNode node)
        {
            if (go == null)
            {
                return null;
            }

            if (HasComponent(node, SpecialListComponentTag))
            {
                return go.GetComponentInChildren<CachedListComponent>(true);
            }

            if (HasComponent(node, SpecialGridComponentTag))
            {
                return go.GetComponentInChildren<CachedGridComponent>(true);
            }

            return go.GetComponent<CachedContainerBase>();
        }

        private static bool IsNoteNode(FigmaPrefabNode node)
        {
            return string.Equals(node?.Tags?.Node, NoteNodeType, StringComparison.OrdinalIgnoreCase);
        }

        private static FigmaPrefabNode FindDirectItemChild(FigmaPrefabNode node)
        {
            var children = node?.Children;
            if (children == null)
            {
                return null;
            }

            for (int i = 0; i < children.Count; i++)
            {
                if (HasComponent(children[i], ItemComponentTag))
                {
                    return children[i];
                }
            }

            return null;
        }

        private static void ClearChildren(Transform transform)
        {
            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                Object.DestroyImmediate(transform.GetChild(i).gameObject);
            }
        }

        private static string ResolvePrefabPath(FigmaPrefabInfo prefab)
        {
            if (prefab == null || string.IsNullOrWhiteSpace(prefab.StagingPath))
            {
                return null;
            }

            string stagingPath = NormalizeAssetPath(prefab.StagingPath);
            if (stagingPath.EndsWith(PrefabExtension, StringComparison.OrdinalIgnoreCase))
            {
                return stagingPath;
            }

            string prefabName = string.IsNullOrWhiteSpace(prefab.Name) ? "FigmaPrefab" : prefab.Name;
            return NormalizeAssetPath(Path.Combine(stagingPath, prefabName + PrefabExtension));
        }

        private static string NormalizeAssetPath(string path)
        {
            return string.IsNullOrWhiteSpace(path) ? path : path.Replace('\\', '/').Trim();
        }

        private static bool IsAssetPath(string path)
        {
            return !string.IsNullOrWhiteSpace(path) && path.StartsWith(AssetsPrefix, StringComparison.Ordinal);
        }
    }
}
