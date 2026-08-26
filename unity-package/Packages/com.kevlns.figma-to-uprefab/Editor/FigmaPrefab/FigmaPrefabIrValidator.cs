using System;
using System.Collections.Generic;
using UnityEngine;

namespace Kevlns.Editor.FigmaToUprefab
{
    public static class FigmaPrefabIrValidator
    {
        private const string RootNodeType = "root";
        private const string NodeNodeType = "node";
        private const string NoteNodeType = "note";
        private const string RcgComponentTag = "rcg";
        private const string ListComponentTag = "list";
        private const string GridComponentTag = "grid";
        private const string SpecialListComponentTag = "slist";
        private const string SpecialGridComponentTag = "sgrid";
        private const string ItemComponentTag = "item";
        private const string ObjectReferenceType = "Object";

        public static FigmaPrefabBuildReport Validate(FigmaPrefabIr ir, FigmaPrefabBuildOptions options = null)
        {
            options = options ?? new FigmaPrefabBuildOptions();
            var report = new FigmaPrefabBuildReport();

            if (ir == null)
            {
                report.AddError("IR_NULL", "IR is null.");
                return report;
            }

            ValidatePrefabInfo(ir.Prefab, report);

            if (ir.Tree == null)
            {
                report.AddError("TREE_MISSING", "IR tree is missing.");
                return report;
            }

            ValidateNodeKeys(ir.Tree, report, "tree");
            ValidateRoot(ir.Tree, report);
            ValidateNode(ir.Tree, null, report, options, "tree");

            return report;
        }

        private static void ValidatePrefabInfo(FigmaPrefabInfo prefab, FigmaPrefabBuildReport report)
        {
            if (prefab == null)
            {
                report.AddError("PREFAB_MISSING", "Prefab info is missing.", "prefab");
                return;
            }

            if (string.IsNullOrWhiteSpace(prefab.Name))
            {
                report.AddError("PREFAB_NAME_MISSING", "Prefab name is missing.", "prefab.name");
            }

            if (string.IsNullOrWhiteSpace(prefab.VariantFrom))
            {
                report.AddError("BASE_PREFAB_MISSING", "Prefab variantFrom is missing.", "prefab.variantFrom");
            }

            if (string.IsNullOrWhiteSpace(prefab.StagingPath))
            {
                report.AddError("STAGING_PATH_MISSING", "Prefab stagingPath is missing.", "prefab.stagingPath");
            }
        }

        private static void ValidateRoot(FigmaPrefabNode root, FigmaPrefabBuildReport report)
        {
            if (!string.Equals(root.Tags?.Node, RootNodeType, StringComparison.OrdinalIgnoreCase))
            {
                report.AddError("ROOT_TAG_MISSING", "Tree root must have tags.node = root.", "tree.tags.node");
            }

            if (!HasComponent(root, RcgComponentTag) && root.Rcg == null)
            {
                report.AddError("ROOT_RCG_MISSING", "Tree root must declare rcg.", "tree.rcg");
            }
        }

        private static void ValidateNodeKeys(
            FigmaPrefabNode node,
            FigmaPrefabBuildReport report,
            string path)
        {
            if (node == null)
            {
                return;
            }

            string nodeType = node.Tags?.Node;
            if (!string.Equals(nodeType, RootNodeType, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(nodeType, NodeNodeType, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(nodeType, NoteNodeType, StringComparison.OrdinalIgnoreCase))
            {
                report.AddError("NODE_TAG_UNSUPPORTED", "Node tag must be root, node, or note.", path + ".tags.node");
                return;
            }

            if (string.Equals(nodeType, NoteNodeType, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(node.Key))
            {
                report.AddError("NODE_KEY_MISSING", "Node key is missing.", path + ".key");
            }
            var children = node.Children;
            if (children == null)
            {
                return;
            }

            for (int i = 0; i < children.Count; i++)
            {
                ValidateNodeKeys(children[i], report, $"{path}.children[{i}]");
            }
        }

        private static void ValidateNode(
            FigmaPrefabNode node,
            FigmaPrefabNode parent,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options,
            string path)
        {
            if (node == null)
            {
                return;
            }

            if (string.Equals(node.Tags?.Node, NoteNodeType, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            bool hasRcg = HasComponent(node, RcgComponentTag) || node.Rcg != null;
            if (hasRcg)
            {
                report.RcgCount++;
                ValidateRcg(node.Rcg, report, options, path + ".rcg");
            }

            ValidateReferences(node, report, path);
            ValidateTextTags(node, report, path);
            ValidateCachedContainer(node, report, options, path);
            ValidateConfiguredMappings(node, report, path);
            ValidateLayout(node, parent, report, path);

            var children = node.Children;
            if (children == null)
            {
                return;
            }

            for (int i = 0; i < children.Count; i++)
            {
                ValidateNode(children[i], node, report, options, $"{path}.children[{i}]");
            }
        }

        private static void ValidateLayout(
            FigmaPrefabNode node,
            FigmaPrefabNode parent,
            FigmaPrefabBuildReport report,
            string path)
        {
            var layout = node.Layout;
            if (layout == null)
            {
                return;
            }

            ValidateConstraint(layout.Constraints?.Horizontal, true, report, path + ".layout.constraints.horizontal");
            ValidateConstraint(layout.Constraints?.Vertical, false, report, path + ".layout.constraints.vertical");
            ValidateSizing(layout.Sizing?.Width, report, path + ".layout.sizing.width");
            ValidateSizing(layout.Sizing?.Height, report, path + ".layout.sizing.height");

            string positioning = NormalizeLayoutValue(layout.Positioning, "auto");
            if (positioning != "auto" && positioning != "absolute")
            {
                report.AddWarning("LAYOUT_POSITIONING_APPROXIMATED", $"Unsupported layout positioning '{layout.Positioning}' is approximated as Auto.", path + ".layout.positioning");
            }

            string align = NormalizeLayoutValue(layout.Align, "inherit");
            if (align != "inherit" && align != "stretch")
            {
                report.AddWarning("AUTO_LAYOUT_CHILD_ALIGN_APPROXIMATED", $"Unsupported per-child alignment '{layout.Align}' is approximated as Inherit.", path + ".layout.align");
            }

            if (layout.Grow < 0f)
            {
                report.AddWarning("AUTO_LAYOUT_GROW_APPROXIMATED", "Negative Auto Layout grow is approximated as zero.", path + ".layout.grow");
            }

            ValidateApproximation(layout.Approximation, report, path + ".layout.approximation");
            ValidateAutoLayout(layout.AutoLayout, report, path + ".layout.autoLayout");
            ValidateResponsiveParent(node, parent, report, path);
            ValidateAutoLayoutChild(node, parent, report, path);
        }

        private static void ValidateApproximation(
            FigmaPrefabLayoutApproximation approximation,
            FigmaPrefabBuildReport report,
            string path)
        {
            if (approximation == null)
            {
                return;
            }

            var selections = new List<string>();
            AddApproximationSelection(selections, "horizontalConstraint", approximation.HorizontalConstraint);
            AddApproximationSelection(selections, "verticalConstraint", approximation.VerticalConstraint);
            AddApproximationSelection(selections, "positioning", approximation.Positioning);
            AddApproximationSelection(selections, "align", approximation.Align);
            AddApproximationSelection(selections, "widthSizing", approximation.WidthSizing);
            AddApproximationSelection(selections, "heightSizing", approximation.HeightSizing);
            AddApproximationSelection(selections, "direction", approximation.Direction);
            AddApproximationSelection(selections, "primaryAlign", approximation.PrimaryAlign);
            AddApproximationSelection(selections, "counterAlign", approximation.CounterAlign);
            if (approximation.Spacing.HasValue)
            {
                selections.Add($"spacing={approximation.Spacing.Value}");
            }

            if (approximation.Padding != null)
            {
                selections.Add($"padding=[{string.Join(",", approximation.Padding)}]");
            }

            if (approximation.SpaceBetween.HasValue)
            {
                selections.Add($"spaceBetween={approximation.SpaceBetween.Value}");
            }

            string selected = selections.Count > 0 ? string.Join(", ", selections) : "deterministic defaults";
            string reason = string.IsNullOrWhiteSpace(approximation.Reason) ? "No model reason was provided." : approximation.Reason;
            report.AddWarning("LAYOUT_MODEL_APPROXIMATION", $"Selected {selected}. Reason: {reason}", path);
        }

        private static void AddApproximationSelection(List<string> selections, string name, string value)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                selections.Add($"{name}={value}");
            }
        }

        private static void ValidateConstraint(
            string value,
            bool horizontal,
            FigmaPrefabBuildReport report,
            string path)
        {
            string normalized = NormalizeLayoutValue(value, "min");
            if (normalized == "min" || normalized == "center" || normalized == "max" ||
                normalized == "stretch" || normalized == "scale")
            {
                return;
            }

            report.AddWarning(
                "LAYOUT_CONSTRAINT_APPROXIMATED",
                $"Unsupported {(horizontal ? "horizontal" : "vertical")} constraint '{value}' is approximated as Min.",
                path);
        }

        private static void ValidateSizing(string value, FigmaPrefabBuildReport report, string path)
        {
            string normalized = NormalizeLayoutValue(value, "fixed");
            if (normalized == "fixed" || normalized == "hug" || normalized == "fill")
            {
                return;
            }

            report.AddWarning("AUTO_LAYOUT_SIZING_APPROXIMATED", $"Unsupported Auto Layout sizing '{value}' is approximated as Fixed.", path);
        }

        private static void ValidateAutoLayout(
            FigmaPrefabAutoLayout autoLayout,
            FigmaPrefabBuildReport report,
            string path)
        {
            if (autoLayout == null)
            {
                return;
            }

            string direction = NormalizeLayoutValue(autoLayout.Direction, null);
            if (direction != "horizontal" && direction != "vertical")
            {
                report.AddWarning("AUTO_LAYOUT_DIRECTION_APPROXIMATED", $"Auto Layout direction '{autoLayout.Direction}' is approximated from child geometry.", path + ".direction");
            }

            string wrap = NormalizeLayoutValue(autoLayout.Wrap, "no_wrap");
            if (wrap != "no_wrap")
            {
                report.AddWarning("AUTO_LAYOUT_WRAP_APPROXIMATED", "Wrapped Auto Layout is approximated as a single line or column.", path + ".wrap");
            }

            string primary = NormalizeLayoutValue(autoLayout.PrimaryAlign, "min");
            if (primary != "min" && primary != "center" && primary != "max" && primary != "space_between")
            {
                report.AddWarning("AUTO_LAYOUT_PRIMARY_ALIGN_APPROXIMATED", $"Primary-axis alignment '{autoLayout.PrimaryAlign}' is approximated as Min.", path + ".primaryAlign");
            }

            string counter = NormalizeLayoutValue(autoLayout.CounterAlign, "min");
            if (counter != "min" && counter != "center" && counter != "max")
            {
                report.AddWarning("AUTO_LAYOUT_COUNTER_ALIGN_APPROXIMATED", $"Counter-axis alignment '{autoLayout.CounterAlign}' is approximated as Min.", path + ".counterAlign");
            }

            if (autoLayout.Padding != null && autoLayout.Padding.Count != 0 && autoLayout.Padding.Count != 4)
            {
                report.AddWarning("AUTO_LAYOUT_PADDING_APPROXIMATED", "Invalid Auto Layout padding is approximated as zero padding.", path + ".padding");
            }
            else if (autoLayout.Padding != null)
            {
                for (int i = 0; i < autoLayout.Padding.Count; i++)
                {
                    if (!Mathf.Approximately(autoLayout.Padding[i], Mathf.Round(autoLayout.Padding[i])))
                    {
                        report.AddWarning(
                            "AUTO_LAYOUT_PADDING_FRACTIONAL_APPROXIMATED",
                            "Fractional Auto Layout padding is rounded to the nearest UGUI RectOffset integer.",
                            path + $".padding[{i}]");
                    }
                }
            }
        }

        private static void ValidateResponsiveParent(
            FigmaPrefabNode node,
            FigmaPrefabNode parent,
            FigmaPrefabBuildReport report,
            string path)
        {
            if (parent == null || node.Layout?.Rect == null)
            {
                return;
            }

            string horizontal = NormalizeLayoutValue(node.Layout.Constraints?.Horizontal, "min");
            string vertical = NormalizeLayoutValue(node.Layout.Constraints?.Vertical, "min");
            bool needsParentWidth = horizontal != "min";
            bool needsParentHeight = vertical != "min";
            if (needsParentWidth && (parent.Layout?.Rect == null || parent.Layout.Rect.Width <= 0f))
            {
                report.AddWarning("LAYOUT_PARENT_WIDTH_APPROXIMATED", "Missing parent width forces best-effort horizontal anchor placement.", path + ".layout.constraints.horizontal");
            }

            if (needsParentHeight && (parent.Layout?.Rect == null || parent.Layout.Rect.Height <= 0f))
            {
                report.AddWarning("LAYOUT_PARENT_HEIGHT_APPROXIMATED", "Missing parent height forces best-effort vertical anchor placement.", path + ".layout.constraints.vertical");
            }
        }

        private static void ValidateAutoLayoutChild(
            FigmaPrefabNode node,
            FigmaPrefabNode parent,
            FigmaPrefabBuildReport report,
            string path)
        {
            var parentAutoLayout = parent?.Layout?.AutoLayout;
            if (parentAutoLayout == null || string.Equals(node.Layout?.Positioning, "absolute", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            bool parentIsHorizontal = string.Equals(parentAutoLayout.Direction, "horizontal", StringComparison.OrdinalIgnoreCase);
            string mainSizing = parentIsHorizontal ? node.Layout?.Sizing?.Width : node.Layout?.Sizing?.Height;
            bool fillsMainAxis = string.Equals(mainSizing, "fill", StringComparison.OrdinalIgnoreCase) || (node.Layout?.Grow ?? 0f) > 0f;
            if (fillsMainAxis && string.Equals(parentAutoLayout.PrimaryAlign, "space_between", StringComparison.OrdinalIgnoreCase))
            {
                report.AddWarning(
                    "AUTO_LAYOUT_SPACE_BETWEEN_FILL_APPROXIMATED",
                    "Space Between with a primary-axis Fill child is approximated by preserving Fill and using fixed item spacing.",
                    path + ".layout.sizing");
            }
        }

        private static string NormalizeLayoutValue(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().ToLowerInvariant();
        }

        private static void ValidateConfiguredMappings(FigmaPrefabNode node, FigmaPrefabBuildReport report, string path)
        {
            if (!string.IsNullOrWhiteSpace(node.ConfiguredPrefabPath) &&
                (!node.ConfiguredPrefabPath.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase) ||
                 !node.ConfiguredPrefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)))
            {
                report.AddError("CONFIGURED_PREFAB_PATH_INVALID", "Configured prefab path must be an Assets/*.prefab path.", path + ".configuredPrefabPath");
            }

            var typeNames = node.ConfiguredComponentTypeNames;
            if (typeNames == null)
            {
                return;
            }

            for (int i = 0; i < typeNames.Count; i++)
            {
                if (string.IsNullOrWhiteSpace(typeNames[i]))
                {
                    report.AddError("CONFIGURED_COMPONENT_TYPE_MISSING", "Configured component type cannot be empty.", path + ".configuredComponentTypeNames[" + i + "]");
                }
            }
        }

        private static void ValidateRcg(
            FigmaPrefabRcg rcg,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options,
            string path)
        {
            if (rcg == null)
            {
                report.AddError("RCG_DATA_MISSING", "Node has rcg tag but rcg data is missing.", path);
                return;
            }

            if (string.IsNullOrWhiteSpace(rcg.SkinName))
            {
                report.AddError("RCG_SKIN_NAME_MISSING", "RCG skinName is missing.", path + ".skinName");
            }

            AddMissingRcgFieldIssue(string.IsNullOrWhiteSpace(rcg.NamespaceName), "RCG_NAMESPACE_MISSING", "RCG namespaceName is missing.", path + ".namespaceName", report, options);
            AddMissingRcgFieldIssue(string.IsNullOrWhiteSpace(rcg.GeneratePath), "RCG_GENERATE_PATH_MISSING", "RCG generatePath is missing.", path + ".generatePath", report, options);
        }

        private static void AddMissingRcgFieldIssue(
            bool isMissing,
            string code,
            string message,
            string path,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options)
        {
            if (!isMissing)
            {
                return;
            }

            if (options.StrictMode)
            {
                report.AddError(code, message, path);
            }
            else
            {
                report.AddWarning(code, message, path);
            }
        }

        private static void ValidateReferences(
            FigmaPrefabNode node,
            FigmaPrefabBuildReport report,
            string path)
        {
            var references = node.References;
            if (references == null)
            {
                return;
            }

            for (int i = 0; i < references.Count; i++)
            {
                var reference = references[i];
                string referencePath = $"{path}.references[{i}]";
                report.ReferenceCount++;

                if (reference == null)
                {
                    report.AddError("REFERENCE_NULL", "Reference item is null.", referencePath);
                    continue;
                }

                if (string.IsNullOrWhiteSpace(reference.Key))
                {
                    report.AddError("REFERENCE_KEY_MISSING", "Reference key is missing.", referencePath + ".key");
                }

                if (string.IsNullOrWhiteSpace(reference.Type))
                {
                    report.AddError("REFERENCE_TYPE_MISSING", "Reference type is missing.", referencePath + ".type");
                }
                else if (!string.Equals(reference.Type, ObjectReferenceType, StringComparison.Ordinal))
                {
                    report.AddWarning("REFERENCE_TYPE_UNSUPPORTED", $"Reference type {reference.Type} is not supported in MVP.", referencePath + ".type");
                }

                if (string.IsNullOrWhiteSpace(reference.TypeName))
                {
                    report.AddError("REFERENCE_TYPE_NAME_MISSING", "Reference typeName is missing.", referencePath + ".typeName");
                }

                if (!string.IsNullOrWhiteSpace(reference.Key) && FindReferenceTarget(node, reference.Key) == null)
                {
                    report.AddError("REFERENCE_KEY_NOT_FOUND", $"Reference key not found: {reference.Key}.", referencePath + ".key");
                    report.MissingReferenceCount++;
                }
            }
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

        private static void ValidateCachedContainer(
            FigmaPrefabNode node,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options,
            string path)
        {
            bool isCachedContainer = IsCachedContainer(node);
            if (!isCachedContainer)
            {
                return;
            }

            report.ListGridCount++;

            int itemCount = CountDirectItemChildren(node);
            if (itemCount == 0)
            {
                AddContainerIssue("CACHED_CONTAINER_ITEM_MISSING", "Cached container has no direct item template.", path, report, options, false);
                return;
            }

            if (itemCount > 1)
            {
                report.AddError("CACHED_CONTAINER_MULTIPLE_ITEMS", "Cached container has multiple direct item templates.", path);
                return;
            }

            var itemNode = FindDirectItemChild(node);
            if (itemNode != null && !HasComponent(itemNode, RcgComponentTag) && itemNode.Rcg == null)
            {
                AddContainerIssue("CACHED_CONTAINER_ITEM_RCG_MISSING", "Cached container item template does not declare rcg.", path, report, options, true);
            }
        }

        private static void ValidateTextTags(FigmaPrefabNode node, FigmaPrefabBuildReport report, string path)
        {
            if (HasComponent(node, "text") && HasComponent(node, "uitext"))
            {
                report.AddError("TEXT_TAG_CONFLICT", "Node cannot declare both text and uitext.", path + ".tags.components");
            }
        }

        private static void AddContainerIssue(
            string code,
            string message,
            string path,
            FigmaPrefabBuildReport report,
            FigmaPrefabBuildOptions options,
            bool strictOnly)
        {
            if (options.StrictMode && strictOnly)
            {
                report.AddError(code, message, path);
                return;
            }

            report.AddWarning(code, message, path);
        }

        private static int CountDirectItemChildren(FigmaPrefabNode node)
        {
            int count = 0;
            var children = node.Children;
            if (children == null)
            {
                return count;
            }

            for (int i = 0; i < children.Count; i++)
            {
                if (HasComponent(children[i], ItemComponentTag))
                {
                    count++;
                }
            }

            return count;
        }

        private static FigmaPrefabNode FindDirectItemChild(FigmaPrefabNode node)
        {
            var children = node.Children;
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
    }
}
