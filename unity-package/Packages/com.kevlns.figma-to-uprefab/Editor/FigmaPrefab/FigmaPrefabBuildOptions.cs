// Copyright © 2026 Vant <sl_kevln@163.com>
namespace Kevlns.Editor.FigmaToUprefab
{
    public class FigmaPrefabBuildOptions
    {
        public bool StrictMode { get; set; }
        public bool AllowTypeFallback { get; set; } = true;
        public bool OverwriteStaging { get; set; } = true;
        public bool DryRun { get; set; }
    }
}
