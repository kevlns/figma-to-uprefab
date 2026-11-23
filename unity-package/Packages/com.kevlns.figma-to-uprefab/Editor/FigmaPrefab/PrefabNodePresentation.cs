// Copyright © 2026 Vant <sl_kevln@163.com>
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Kevlns.Editor.FigmaToUprefab
{
    public sealed class PrefabNodePresentation
    {
        public float PivotX, PivotY, Rotation;
        public float ScaleX = 1, ScaleY = 1;
        public string Text, SpriteKey;
        public JObject Typography;

        internal static void Apply(FigmaPrefabNode node, Transform target, Dictionary<string, Sprite> sprites, bool bound = false)
        {
            var p = node.Presentation;
            if (p != null)
            {
                var rt = target as RectTransform;
                if (!rt || node.Layout?.Rect == null) throw new InvalidOperationException("Missing RectTransform or IR rect: " + node.FigmaNodeId);
                var pivot = new Vector2(p.PivotX, p.PivotY);
                var delta = pivot - rt.pivot;
                rt.anchoredPosition += new Vector2(delta.x * node.Layout.Rect.Width, delta.y * node.Layout.Rect.Height);
                rt.pivot = pivot;
                rt.localRotation = Quaternion.Euler(0, 0, p.Rotation);
                rt.localScale = new Vector3(p.ScaleX, p.ScaleY, 1);
                if (p.Typography != null) ApplyTypography(p.Typography, target);
                if (bound || node.InstanceOverrides != null)
                {
                    target.gameObject.SetActive(node.Visible);
                    if (p.Text != null)
                    {
                        var tmp = target.GetComponent<TMPro.TMP_Text>();
                        var text = target.GetComponent<UnityEngine.UI.Text>();
                        if (!tmp && !text) throw new InvalidOperationException("Missing text component: " + node.FigmaNodeId);
                        if (tmp) tmp.text = p.Text;
                        if (text) text.text = p.Text;
                    }
                    if (p.SpriteKey != null)
                    {
                        var image = target.GetComponent<UnityEngine.UI.Image>();
                        if (!image || !sprites.TryGetValue(p.SpriteKey, out var sprite)) throw new InvalidOperationException("Missing sprite binding: " + node.FigmaNodeId);
                        image.sprite = sprite;
                    }
                }
            }
            var overrides = node.InstanceOverrides ?? (bound ? node.Children : null);
            if (overrides == null) return;
            foreach (var child in overrides)
            {
                var matches = Enumerable.Range(0, target.childCount).Select(i => target.GetChild(i)).Where(t => t.name == child.Name).ToList();
                if (matches.Count == 0) matches = target.GetComponentsInChildren<RectTransform>(true).Where(t => t != target && t.name == child.Name).Cast<Transform>().ToList();
                if (matches.Count != 1) throw new InvalidOperationException("Cannot locate unique instance override: " + child.FigmaNodeId);
                Apply(child, matches[0], sprites, true);
            }
        }
        static void ApplyTypography(JObject style, Transform target)
        {
            var tmp = target.GetComponent<TMPro.TMP_Text>();
            var legacy = target.GetComponent<UnityEngine.UI.Text>();
            if (!tmp && !legacy) throw new Exception("无法应用文字样式：" + target.name);
            Color color;
            if (ColorUtility.TryParseHtmlString(style.Value<string>("color") ?? "", out color)) {
                if (tmp) tmp.color = color; if (legacy) legacy.color = color;
            }
            if (style["size"] != null) {
                var size = style.Value<float>("size");
                if (tmp) { tmp.enableAutoSizing = false; tmp.fontSize = size; }
                if (legacy) { legacy.resizeTextForBestFit = false; legacy.fontSize = Mathf.RoundToInt(size); }
            }
            if (style["bold"] != null) {
                bool bold = style.Value<bool>("bold");
                if (tmp) tmp.fontStyle = bold ? tmp.fontStyle | TMPro.FontStyles.Bold : tmp.fontStyle & ~TMPro.FontStyles.Bold;
                if (legacy) legacy.fontStyle = bold ? FontStyle.Bold : FontStyle.Normal;
            }
            var align = style.Value<string>("align");
            if (align != null) {
                if (tmp) tmp.horizontalAlignment = align=="center" ? TMPro.HorizontalAlignmentOptions.Center : align=="right" ? TMPro.HorizontalAlignmentOptions.Right : TMPro.HorizontalAlignmentOptions.Left;
                if (legacy) legacy.alignment = align=="center" ? TextAnchor.UpperCenter : align=="right" ? TextAnchor.UpperRight : TextAnchor.UpperLeft;
            }
            var guid = style.Value<string>("fontGuid");
            if (guid != null) {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (tmp) tmp.font = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(path) ?? throw new Exception("TMP 字体资源不存在：" + guid);
                if (legacy) legacy.font = AssetDatabase.LoadAssetAtPath<Font>(path) ?? throw new Exception("字体资源不存在：" + guid);
            }
        }

    }
}
