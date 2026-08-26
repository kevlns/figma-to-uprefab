using System.Collections.Generic;
using Newtonsoft.Json;

namespace Kevlns.Editor.FigmaToUprefab
{
    public class FigmaPrefabIr
    {
        [JsonProperty("prefab")]
        public FigmaPrefabInfo Prefab { get; set; }

        [JsonProperty("assets")]
        public List<FigmaPrefabAsset> Assets { get; set; } = new List<FigmaPrefabAsset>();

        [JsonProperty("tree")]
        public FigmaPrefabNode Tree { get; set; }
    }

    public class FigmaPrefabInfo
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("variantFrom")]
        public string VariantFrom { get; set; }

        [JsonProperty("stagingPath")]
        public string StagingPath { get; set; }

        [JsonProperty("domain")]
        public string Domain { get; set; }

        [JsonProperty("figma")]
        public FigmaPrefabSource Figma { get; set; }
    }

    public class FigmaPrefabSource
    {
        [JsonProperty("fileKey")]
        public string FileKey { get; set; }

        [JsonProperty("frameNodeId")]
        public string FrameNodeId { get; set; }

        [JsonProperty("frameName")]
        public string FrameName { get; set; }
    }

    public class FigmaPrefabAsset
    {
        [JsonProperty("key")]
        public string Key { get; set; }

        [JsonProperty("format")]
        public string Format { get; set; }

        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("exportMode")]
        public string ExportMode { get; set; }

        [JsonProperty("sharedAsset")]
        public bool SharedAsset { get; set; }

        [JsonProperty("sourceAssetNodeId")]
        public string SourceAssetNodeId { get; set; }

        [JsonProperty("destPath")]
        public string DestPath { get; set; }

        [JsonProperty("import")]
        public FigmaPrefabAssetImport Import { get; set; }
    }

    public class FigmaPrefabAssetImport
    {
        [JsonProperty("textureType")]
        public string TextureType { get; set; }
    }

    public class FigmaPrefabNode
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("key")]
        public string Key { get; set; }

        [JsonProperty("tags")]
        public FigmaPrefabTags Tags { get; set; }

        [JsonProperty("rcg")]
        public FigmaPrefabRcg Rcg { get; set; }

        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("figmaName")]
        public string FigmaName { get; set; }

        [JsonProperty("visible")]
        public bool Visible { get; set; } = true;

        [JsonProperty("configuredPrefabPath")]
        public string ConfiguredPrefabPath { get; set; }

        [JsonProperty("configuredComponentTypeNames")]
        public List<string> ConfiguredComponentTypeNames { get; set; } = new List<string>();

        [JsonProperty("layout")]
        public FigmaPrefabLayout Layout { get; set; }

        [JsonProperty("components")]
        public Dictionary<string, object> Components { get; set; } = new Dictionary<string, object>();

        [JsonProperty("references")]
        public List<FigmaPrefabReference> References { get; set; } = new List<FigmaPrefabReference>();

        [JsonProperty("children")]
        public List<FigmaPrefabNode> Children { get; set; } = new List<FigmaPrefabNode>();
    }

    public class FigmaPrefabTags
    {
        [JsonProperty("node")]
        public string Node { get; set; }

        [JsonProperty("components")]
        public List<string> Components { get; set; } = new List<string>();
    }

    public class FigmaPrefabRcg
    {
        [JsonProperty("namespaceName")]
        public string NamespaceName { get; set; }

        [JsonProperty("skinName")]
        public string SkinName { get; set; }

        [JsonProperty("generatePath")]
        public string GeneratePath { get; set; }
    }

    public class FigmaPrefabReference
    {
        [JsonProperty("key")]
        public string Key { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("typeName")]
        public string TypeName { get; set; }

    }

    public class FigmaPrefabLayout
    {
        [JsonProperty("autoLayout")]
        public FigmaPrefabAutoLayout AutoLayout { get; set; }

        [JsonProperty("rect")]
        public FigmaPrefabRect Rect { get; set; }

        [JsonProperty("sizing")]
        public FigmaPrefabSizing Sizing { get; set; }

        [JsonProperty("constraints")]
        public FigmaPrefabConstraints Constraints { get; set; }

        [JsonProperty("positioning")]
        public string Positioning { get; set; }

        [JsonProperty("align")]
        public string Align { get; set; }

        [JsonProperty("grow")]
        public float Grow { get; set; }

        [JsonProperty("approximation")]
        public FigmaPrefabLayoutApproximation Approximation { get; set; }
    }

    public class FigmaPrefabLayoutApproximation
    {
        [JsonProperty("horizontalConstraint")]
        public string HorizontalConstraint { get; set; }

        [JsonProperty("verticalConstraint")]
        public string VerticalConstraint { get; set; }

        [JsonProperty("positioning")]
        public string Positioning { get; set; }

        [JsonProperty("align")]
        public string Align { get; set; }

        [JsonProperty("widthSizing")]
        public string WidthSizing { get; set; }

        [JsonProperty("heightSizing")]
        public string HeightSizing { get; set; }

        [JsonProperty("direction")]
        public string Direction { get; set; }

        [JsonProperty("primaryAlign")]
        public string PrimaryAlign { get; set; }

        [JsonProperty("counterAlign")]
        public string CounterAlign { get; set; }

        [JsonProperty("spacing")]
        public float? Spacing { get; set; }

        [JsonProperty("padding")]
        public List<float> Padding { get; set; }

        [JsonProperty("spaceBetween")]
        public bool? SpaceBetween { get; set; }

        [JsonProperty("reason")]
        public string Reason { get; set; }
    }

    public class FigmaPrefabAutoLayout
    {
        [JsonProperty("direction")]
        public string Direction { get; set; }

        [JsonProperty("spacing")]
        public float Spacing { get; set; }

        [JsonProperty("padding")]
        public List<float> Padding { get; set; } = new List<float>();

        [JsonProperty("primaryAlign")]
        public string PrimaryAlign { get; set; }

        [JsonProperty("counterAlign")]
        public string CounterAlign { get; set; }

        [JsonProperty("wrap")]
        public string Wrap { get; set; }
    }

    public class FigmaPrefabConstraints
    {
        [JsonProperty("horizontal")]
        public string Horizontal { get; set; }

        [JsonProperty("vertical")]
        public string Vertical { get; set; }
    }

    public class FigmaPrefabRect
    {
        [JsonProperty("x")]
        public float X { get; set; }

        [JsonProperty("y")]
        public float Y { get; set; }

        [JsonProperty("w")]
        public float Width { get; set; }

        [JsonProperty("h")]
        public float Height { get; set; }
    }

    public class FigmaPrefabSizing
    {
        [JsonProperty("width")]
        public string Width { get; set; }

        [JsonProperty("height")]
        public string Height { get; set; }
    }
}
