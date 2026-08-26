using System;
using System.Collections.Generic;
using System.Text;

namespace Kevlns.Editor.FigmaToUprefab
{
    public interface IFigmaPrefabIdentifierTranslator
    {
        string Translate(string source);
    }

    public sealed class FigmaPrefabIdentifierTranslator : IFigmaPrefabIdentifierTranslator
    {
        private readonly IDictionary<string, string> _translations;

        public FigmaPrefabIdentifierTranslator(IDictionary<string, string> translations = null)
        {
            _translations = translations ?? new Dictionary<string, string>(StringComparer.Ordinal);
        }

        public string Translate(string source)
        {
            if (string.IsNullOrWhiteSpace(source))
            {
                throw new InvalidOperationException("Identifier source is empty.");
            }

            if (_translations.TryGetValue(source, out var translated) && !string.IsNullOrWhiteSpace(translated))
            {
                return Escape(translated);
            }

            for (int i = 0; i < source.Length; i++)
            {
                if (source[i] > 127)
                {
                    throw new InvalidOperationException($"Missing English translation for identifier: {source}.");
                }
            }

            return Escape(source);
        }

        private static string Escape(string value)
        {
            var builder = new StringBuilder(value.Length);
            for (int i = 0; i < value.Length; i++)
            {
                char character = value[i];
                if (char.IsLetterOrDigit(character) || character == '_')
                {
                    builder.Append(character);
                }
                else
                {
                    builder.Append('_');
                }
            }

            if (builder.Length == 0)
            {
                throw new InvalidOperationException("Identifier is empty after escaping.");
            }

            if (char.IsDigit(builder[0]))
            {
                builder.Insert(0, '_');
            }

            return builder.ToString();
        }
    }

    public sealed class FigmaPrefabConversionRequest
    {
        public FigmaPrefabInfo Prefab { get; set; }

        public FigmaPrefabSourceNode Root { get; set; }

        public IFigmaPrefabIdentifierTranslator IdentifierTranslator { get; set; }

        public FigmaPrefabRcg RcgDefaults { get; set; }
    }

    public sealed class FigmaPrefabSourceNode
    {
        public string Name { get; set; }

        public string FigmaNodeId { get; set; }

        public bool Visible { get; set; } = true;

        public FigmaPrefabLayout Layout { get; set; }

        public Dictionary<string, object> Components { get; set; } = new Dictionary<string, object>();

        public FigmaPrefabRcg Rcg { get; set; }

        public List<FigmaPrefabSourceNode> Children { get; set; } = new List<FigmaPrefabSourceNode>();
    }

    public sealed class FigmaPrefabConversionResult
    {
        public FigmaPrefabIr Ir { get; set; }

        public List<FigmaPrefabConversionIssue> Issues { get; } = new List<FigmaPrefabConversionIssue>();

        public bool HasErrors
        {
            get
            {
                for (int i = 0; i < Issues.Count; i++)
                {
                    if (Issues[i].IsError)
                    {
                        return true;
                    }
                }

                return false;
            }
        }
    }

    public sealed class FigmaPrefabConversionIssue
    {
        public bool IsError { get; set; }

        public string Code { get; set; }

        public string Message { get; set; }

        public string FigmaNodeId { get; set; }
    }

    public static class FigmaPrefabConverter
    {
        private const string RootCategory = "root";
        private const string NodeCategory = "node";
        private const string NoteCategory = "note";
        private const string ListComponent = "list";
        private const string GridComponent = "grid";
        private const string SpecialListComponent = "slist";
        private const string SpecialGridComponent = "sgrid";
        private const string ItemComponent = "item";
        private const string DefaultNodeName = "__node__";

        public static FigmaPrefabConversionResult Convert(FigmaPrefabConversionRequest request)
        {
            var result = new FigmaPrefabConversionResult();
            if (request == null || request.Root == null)
            {
                AddError(result, "SOURCE_ROOT_MISSING", "Figma source root is missing.", null);
                return result;
            }

            var translator = request.IdentifierTranslator ?? new FigmaPrefabIdentifierTranslator();
            var mappings = new List<SourceMapping>();
            var roots = ConvertNode(request.Root, null, translator, result, mappings);
            if (roots.Count != 1 || !IsCategory(roots.Count == 1 ? roots[0] : null, RootCategory))
            {
                AddError(result, "ROOT_INVALID", "Exactly one exported root node is required.", request.Root.FigmaNodeId);
                return result;
            }

            var root = roots[0];
            if (request.Prefab != null &&
                !string.Equals(request.Prefab.Name, root.Name, StringComparison.Ordinal))
            {
                AddError(
                    result,
                    "PREFAB_ROOT_NAME_MISMATCH",
                    $"Prefab name '{request.Prefab.Name}' must match translated root name '{root.Name}'.",
                    request.Root.FigmaNodeId);
            }

            for (int i = 0; i < mappings.Count; i++)
            {
                ResolveCell(mappings[i], mappings, result);
            }

            PopulateRcgMetadata(root, request.RcgDefaults, result);
            PopulateReferences(root, mappings);
            result.Ir = new FigmaPrefabIr
            {
                Prefab = request.Prefab,
                Tree = root
            };
            return result;
        }

        private static List<FigmaPrefabNode> ConvertNode(
            FigmaPrefabSourceNode source,
            FigmaPrefabNode parent,
            IFigmaPrefabIdentifierTranslator translator,
            FigmaPrefabConversionResult result,
            List<SourceMapping> mappings)
        {
            var converted = new List<FigmaPrefabNode>();
            if (source == null)
            {
                return converted;
            }

            var tags = ParseTags(source.Name);
            string category = GetCategory(tags);
            if (HasUnsupportedLegacyTag(tags))
            {
                AddError(result, "LEGACY_TAG_UNSUPPORTED", "alias, rcgItem, and item are not supported Figma tags.", source.FigmaNodeId);
                return converted;
            }

            if (string.Equals(category, NoteCategory, StringComparison.Ordinal))
            {
                return converted;
            }

            FigmaPrefabNode node = null;
            FigmaPrefabNode childParent = parent;
            if (string.Equals(category, RootCategory, StringComparison.Ordinal) || string.Equals(category, NodeCategory, StringComparison.Ordinal))
            {
                if (!tags.TryGetValue("name", out var name) || string.IsNullOrWhiteSpace(name))
                {
                    name = DefaultNodeName;
                }

                string translatedName;
                string key;
                try
                {
                    translatedName = translator.Translate(name);
                    key = tags.TryGetValue("ref", out var reference) && !string.IsNullOrWhiteSpace(reference)
                        ? translator.Translate(reference)
                        : translatedName;
                }
                catch (Exception exception)
                {
                    AddError(result, "IDENTIFIER_TRANSLATION_FAILED", exception.Message, source.FigmaNodeId);
                    return converted;
                }

                var componentConfigs = CopyComponents(source.Components);
                node = new FigmaPrefabNode
                {
                    Name = translatedName,
                    Key = key,
                    FigmaNodeId = source.FigmaNodeId,
                    FigmaName = source.Name,
                    Visible = source.Visible,
                    Layout = source.Layout,
                    Components = componentConfigs,
                    Rcg = source.Rcg,
                    Tags = new FigmaPrefabTags
                    {
                        Node = category,
                        Components = GetComponentTags(tags, componentConfigs, result, source.FigmaNodeId)
                    }
                };
                childParent = node;
                mappings.Add(new SourceMapping
                {
                    Source = source,
                    Node = node,
                    Parent = parent,
                    IsCell = tags.ContainsKey("cell"),
                    IsReference = tags.ContainsKey("ref")
                });
                converted.Add(node);
            }

            var children = source.Children;
            if (children == null)
            {
                return converted;
            }

            for (int i = 0; i < children.Count; i++)
            {
                var childNodes = ConvertNode(children[i], childParent, translator, result, mappings);
                for (int childIndex = 0; childIndex < childNodes.Count; childIndex++)
                {
                    if (childParent != null)
                    {
                        childParent.Children.Add(childNodes[childIndex]);
                    }
                    else
                    {
                        converted.Add(childNodes[childIndex]);
                    }
                }
            }

            return converted;
        }

        private static void PopulateRcgMetadata(
            FigmaPrefabNode root,
            FigmaPrefabRcg defaults,
            FigmaPrefabConversionResult result)
        {
            var skinNames = new HashSet<string>(StringComparer.Ordinal);
            PopulateRcgMetadata(root, defaults, result, new List<FigmaPrefabNode>(), skinNames);
        }

        private static void PopulateRcgMetadata(
            FigmaPrefabNode node,
            FigmaPrefabRcg defaults,
            FigmaPrefabConversionResult result,
            List<FigmaPrefabNode> path,
            HashSet<string> skinNames)
        {
            if (node == null)
            {
                return;
            }

            path.Add(node);
            if (HasComponent(node, "rcg") || node.Rcg != null)
            {
                node.Rcg = node.Rcg ?? new FigmaPrefabRcg();
                if (string.IsNullOrWhiteSpace(node.Rcg.NamespaceName))
                {
                    node.Rcg.NamespaceName = defaults?.NamespaceName;
                }

                if (string.IsNullOrWhiteSpace(node.Rcg.GeneratePath))
                {
                    node.Rcg.GeneratePath = defaults?.GeneratePath;
                }

                if (string.IsNullOrWhiteSpace(node.Rcg.SkinName))
                {
                    node.Rcg.SkinName = InferRcgSkinName(path);
                }

                if (!skinNames.Add(node.Rcg.SkinName))
                {
                    AddError(
                        result,
                        "RCG_SKIN_NAME_DUPLICATE",
                        $"RCG skinName must be unique within one prefab: {node.Rcg.SkinName}.",
                        node.FigmaNodeId);
                }
            }

            for (int i = 0; i < node.Children.Count; i++)
            {
                PopulateRcgMetadata(node.Children[i], defaults, result, path, skinNames);
            }

            path.RemoveAt(path.Count - 1);
        }

        private static string InferRcgSkinName(List<FigmaPrefabNode> path)
        {
            var root = path[0];
            var node = path[path.Count - 1];
            if (path.Count == 1)
            {
                return root.Name + "Skin";
            }

            if (HasComponent(node, ItemComponent))
            {
                for (int index = path.Count - 2; index > 0; index--)
                {
                    var ancestor = path[index];
                    if (HasComponent(ancestor, ListComponent) ||
                        HasComponent(ancestor, GridComponent) ||
                        HasComponent(ancestor, SpecialListComponent) ||
                        HasComponent(ancestor, SpecialGridComponent))
                    {
                        return root.Name + ancestor.Name + node.Name + "Skin";
                    }
                }
            }

            return root.Name + node.Name + "Skin";
        }

        private static void ResolveCell(SourceMapping cell, List<SourceMapping> mappings, FigmaPrefabConversionResult result)
        {
            if (!cell.IsCell)
            {
                return;
            }

            FigmaPrefabNode container = FindNearestContainer(cell, mappings);
            if (container == null)
            {
                AddError(result, "CELL_CONTAINER_MISSING", "Cell has no list/grid ancestor.", cell.Source.FigmaNodeId);
                return;
            }

            if (cell.Parent != null)
            {
                cell.Parent.Children.Remove(cell.Node);
            }

            int itemCount = CountItems(container);
            if (itemCount > 0)
            {
                AddError(result, "CELL_CONTAINER_MULTIPLE", "List/grid has more than one cell template.", cell.Source.FigmaNodeId);
                return;
            }

            cell.Node.Tags.Components.Add(ItemComponent);
            container.Children.Add(cell.Node);
        }

        private static FigmaPrefabNode FindNearestContainer(SourceMapping cell, List<SourceMapping> mappings)
        {
            var current = cell.Parent;
            while (current != null)
            {
                if (IsCachedContainer(current))
                {
                    return current;
                }

                current = FindParent(current, mappings);
            }

            return null;
        }

        private static FigmaPrefabNode FindParent(FigmaPrefabNode node, List<SourceMapping> mappings)
        {
            for (int i = 0; i < mappings.Count; i++)
            {
                if (mappings[i].Node == node)
                {
                    return mappings[i].Parent;
                }
            }

            return null;
        }

        private static int CountItems(FigmaPrefabNode container)
        {
            int count = 0;
            for (int i = 0; i < container.Children.Count; i++)
            {
                if (HasComponent(container.Children[i], ItemComponent))
                {
                    count++;
                }
            }

            return count;
        }

        private static void PopulateReferences(FigmaPrefabNode root, List<SourceMapping> mappings)
        {
            PopulateReferences(root, null, mappings);
        }

        private static void PopulateReferences(FigmaPrefabNode node, FigmaPrefabNode owner, List<SourceMapping> mappings)
        {
            if (node == null)
            {
                return;
            }

            bool isRcg = HasComponent(node, "rcg") || node.Rcg != null;
            var referenceOwner = isRcg ? node : owner;
            var mapping = FindMapping(node, mappings);
            if (owner != null && mapping != null && mapping.IsReference)
            {
                owner.References.Add(new FigmaPrefabReference
                {
                    Key = node.Key,
                    Type = "Object",
                    TypeName = ResolveReferenceType(node)
                });
            }

            var children = node.Children;
            for (int i = 0; i < children.Count; i++)
            {
                PopulateReferences(children[i], referenceOwner, mappings);
            }
        }

        private static SourceMapping FindMapping(FigmaPrefabNode node, List<SourceMapping> mappings)
        {
            for (int i = 0; i < mappings.Count; i++)
            {
                if (mappings[i].Node == node)
                {
                    return mappings[i];
                }
            }

            return null;
        }

        private static string ResolveReferenceType(FigmaPrefabNode node)
        {
            if (HasComponent(node, "image"))
            {
                return "UnityEngine.UI.Image";
            }

            if (HasComponent(node, "text"))
            {
                return "TMPro.TextMeshProUGUI";
            }

            if (HasComponent(node, "uitext"))
            {
                return "UnityEngine.UI.Text";
            }

            if (HasComponent(node, "button"))
            {
                return "UnityEngine.UI.Button";
            }

            if (HasComponent(node, ListComponent) || HasComponent(node, SpecialListComponent))
            {
                return "Vant.System.UI.CachedListComponent";
            }

            if (HasComponent(node, GridComponent) || HasComponent(node, SpecialGridComponent))
            {
                return "Vant.System.UI.CachedGridComponent";
            }

            return "UnityEngine.GameObject";
        }

        private static Dictionary<string, string> ParseTags(string sourceName)
        {
            var tags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(sourceName))
            {
                return tags;
            }

            int index = 0;
            while (index < sourceName.Length)
            {
                int start = sourceName.IndexOf('[', index);
                if (start < 0)
                {
                    break;
                }

                int end = sourceName.IndexOf(']', start + 1);
                if (end < 0)
                {
                    break;
                }

                string token = sourceName.Substring(start + 1, end - start - 1).Trim();
                int equalsIndex = token.IndexOf('=');
                int colonIndex = token.IndexOf(':');
                if (equalsIndex > 0)
                {
                    tags[token.Substring(0, equalsIndex).Trim()] = token.Substring(equalsIndex + 1).Trim();
                }
                else if (colonIndex > 0)
                {
                    tags[token.Substring(0, colonIndex).Trim()] = token.Substring(colonIndex + 1).Trim();
                }
                else if (!string.IsNullOrWhiteSpace(token))
                {
                    tags[token] = string.Empty;
                }

                index = end + 1;
            }

            return tags;
        }

        private static string GetCategory(Dictionary<string, string> tags)
        {
            if (tags.ContainsKey(RootCategory))
            {
                return RootCategory;
            }

            if (tags.ContainsKey(NodeCategory))
            {
                return NodeCategory;
            }

            if (tags.ContainsKey(NoteCategory))
            {
                return NoteCategory;
            }

            return null;
        }

        private static List<string> GetComponentTags(
            Dictionary<string, string> tags,
            Dictionary<string, object> componentConfigs,
            FigmaPrefabConversionResult result,
            string figmaNodeId)
        {
            var components = new List<string>();
            string category = GetCategory(tags);
            if (!string.IsNullOrWhiteSpace(category) && tags.TryGetValue(category, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                string[] items = value.Split(',');
                for (int i = 0; i < items.Length; i++)
                {
                    string component = items[i].Trim();
                    if (string.Equals(component, "img", StringComparison.OrdinalIgnoreCase))
                    {
                        component = "image";
                    }
                    else if (TryNormalizeContainerComponent(component, componentConfigs, out var normalizedComponent, out var error))
                    {
                        component = normalizedComponent;
                    }
                    else if (!string.IsNullOrWhiteSpace(error))
                    {
                        AddError(result, "CONTAINER_SUFFIX_INVALID", error, figmaNodeId);
                        continue;
                    }
                    if (!string.IsNullOrWhiteSpace(component))
                    {
                        components.Add(component);
                    }
                }
            }

            return components;
        }

        private static bool TryNormalizeContainerComponent(
            string component,
            Dictionary<string, object> componentConfigs,
            out string normalizedComponent,
            out string error)
        {
            normalizedComponent = null;
            error = null;
            if (string.IsNullOrWhiteSpace(component))
            {
                return false;
            }

            if (component.StartsWith(ListComponent, StringComparison.OrdinalIgnoreCase))
            {
                return TryNormalizeListComponent(component, ListComponent, componentConfigs, out normalizedComponent, out error);
            }

            if (component.StartsWith(SpecialListComponent, StringComparison.OrdinalIgnoreCase))
            {
                return TryNormalizeListComponent(component, SpecialListComponent, componentConfigs, out normalizedComponent, out error);
            }

            if (component.StartsWith(GridComponent, StringComparison.OrdinalIgnoreCase))
            {
                return TryNormalizeGridComponent(component, GridComponent, componentConfigs, out normalizedComponent, out error);
            }

            if (component.StartsWith(SpecialGridComponent, StringComparison.OrdinalIgnoreCase))
            {
                return TryNormalizeGridComponent(component, SpecialGridComponent, componentConfigs, out normalizedComponent, out error);
            }

            return false;
        }

        private static bool TryNormalizeListComponent(
            string component,
            string baseComponent,
            Dictionary<string, object> componentConfigs,
            out string normalizedComponent,
            out string error)
        {
            normalizedComponent = null;
            error = null;
            if (!component.StartsWith(baseComponent, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (string.Equals(component, baseComponent, StringComparison.OrdinalIgnoreCase))
            {
                normalizedComponent = baseComponent;
                return true;
            }

            if (component.Length == baseComponent.Length + 2 && component[baseComponent.Length] == '-')
            {
                char direction = char.ToLowerInvariant(component[component.Length - 1]);
                if (direction == 'h' || direction == 'v')
                {
                    SetContainerConfig(componentConfigs, baseComponent, "direction", direction == 'h' ? "horizontal" : "vertical");
                    normalizedComponent = baseComponent;
                    return true;
                }
            }

            error = $"List component suffix must be -h or -v: {component}.";
            return false;
        }

        private static bool TryNormalizeGridComponent(
            string component,
            string baseComponent,
            Dictionary<string, object> componentConfigs,
            out string normalizedComponent,
            out string error)
        {
            normalizedComponent = null;
            error = null;
            if (!component.StartsWith(baseComponent, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (string.Equals(component, baseComponent, StringComparison.OrdinalIgnoreCase))
            {
                normalizedComponent = baseComponent;
                return true;
            }

            if (component.Length <= baseComponent.Length + 1 || component[baseComponent.Length] != '-')
            {
                error = $"Grid component suffix must use -r<rows> and/or -c<columns>: {component}.";
                return false;
            }

            string suffix = component.Substring(baseComponent.Length + 1);
            int index = 0;
            bool hasRows = false;
            bool hasColumns = false;
            while (index < suffix.Length)
            {
                char kind = char.ToLowerInvariant(suffix[index]);
                if ((kind != 'r' && kind != 'c') || (kind == 'r' && hasRows) || (kind == 'c' && hasColumns))
                {
                    error = $"Grid component suffix is invalid: {component}.";
                    return false;
                }

                int numberStart = ++index;
                while (index < suffix.Length && char.IsDigit(suffix[index]))
                {
                    index++;
                }

                if (numberStart == index || !int.TryParse(suffix.Substring(numberStart, index - numberStart), out var value) || value <= 0)
                {
                    error = $"Grid component row and column limits must be positive integers: {component}.";
                    return false;
                }

                if (kind == 'r')
                {
                    hasRows = true;
                    SetContainerConfig(componentConfigs, baseComponent, "maxRows", value);
                }
                else
                {
                    hasColumns = true;
                    SetContainerConfig(componentConfigs, baseComponent, "maxColumns", value);
                }
            }

            normalizedComponent = baseComponent;
            return true;
        }

        private static void SetContainerConfig(Dictionary<string, object> componentConfigs, string component, string property, object value)
        {
            if (!componentConfigs.TryGetValue(component, out var rawConfig) || !(rawConfig is Dictionary<string, object> config))
            {
                config = new Dictionary<string, object>(StringComparer.Ordinal);
                componentConfigs[component] = config;
            }

            config[property] = value;
        }

        private static Dictionary<string, object> CopyComponents(Dictionary<string, object> source)
        {
            return source == null
                ? new Dictionary<string, object>(StringComparer.Ordinal)
                : new Dictionary<string, object>(source, StringComparer.Ordinal);
        }

        private static bool HasUnsupportedLegacyTag(Dictionary<string, string> tags)
        {
            if (tags.ContainsKey("alias") || tags.ContainsKey("rcgitem") || tags.ContainsKey(ItemComponent))
            {
                return true;
            }

            string category = GetCategory(tags);
            return !string.IsNullOrWhiteSpace(category)
                   && tags.TryGetValue(category, out var components)
                   && ContainsComponent(components, ItemComponent);
        }

        private static bool ContainsComponent(string components, string component)
        {
            if (string.IsNullOrWhiteSpace(components))
            {
                return false;
            }

            string[] items = components.Split(',');
            for (int i = 0; i < items.Length; i++)
            {
                if (string.Equals(items[i].Trim(), component, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool IsCategory(FigmaPrefabNode node, string category)
        {
            return string.Equals(node?.Tags?.Node, category, StringComparison.Ordinal);
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
            return HasComponent(node, ListComponent) ||
                   HasComponent(node, GridComponent) ||
                   HasComponent(node, SpecialListComponent) ||
                   HasComponent(node, SpecialGridComponent);
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

        private sealed class SourceMapping
        {
            public FigmaPrefabSourceNode Source { get; set; }

            public FigmaPrefabNode Node { get; set; }

            public FigmaPrefabNode Parent { get; set; }

            public bool IsCell { get; set; }

            public bool IsReference { get; set; }
        }
    }
}
