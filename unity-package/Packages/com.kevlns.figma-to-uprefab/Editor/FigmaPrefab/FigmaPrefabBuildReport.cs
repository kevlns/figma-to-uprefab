using System.Collections.Generic;

namespace Kevlns.Editor.FigmaToUprefab
{
    public enum FigmaPrefabBuildIssueSeverity
    {
        Warning,
        Error
    }

    public class FigmaPrefabBuildIssue
    {
        public FigmaPrefabBuildIssueSeverity Severity { get; set; }
        public string Code { get; set; }
        public string Message { get; set; }
        public string Path { get; set; }
    }

    public class FigmaPrefabBuildReport
    {
        public string PrefabPath { get; set; }
        public string BasePrefabPath { get; set; }
        public bool Overwritten { get; set; }
        public int RcgCount { get; set; }
        public int ReferenceCount { get; set; }
        public int ListGridCount { get; set; }
        public int MissingReferenceCount { get; set; }
        public int FallbackReferenceCount { get; set; }
        public bool StagingOnly { get; set; } = true;
        public string SuggestedPromotionPrefabPath { get; set; }
        public string SuggestedPromotionSpriteFolder { get; set; }
        public List<string> AssetPaths { get; } = new List<string>();
        public List<string> ItemPrefabPaths { get; } = new List<string>();
        public List<FigmaPrefabBuildIssue> Issues { get; } = new List<FigmaPrefabBuildIssue>();

        public bool HasErrors
        {
            get
            {
                return ErrorCount > 0;
            }
        }

        public int WarningCount
        {
            get
            {
                return CountIssues(FigmaPrefabBuildIssueSeverity.Warning);
            }
        }

        public int ErrorCount
        {
            get
            {
                return CountIssues(FigmaPrefabBuildIssueSeverity.Error);
            }
        }

        public void AddWarning(string code, string message, string path = null)
        {
            AddIssue(FigmaPrefabBuildIssueSeverity.Warning, code, message, path);
        }

        public void AddError(string code, string message, string path = null)
        {
            AddIssue(FigmaPrefabBuildIssueSeverity.Error, code, message, path);
        }

        private void AddIssue(FigmaPrefabBuildIssueSeverity severity, string code, string message, string path)
        {
            Issues.Add(new FigmaPrefabBuildIssue
            {
                Severity = severity,
                Code = code,
                Message = message,
                Path = path
            });
        }

        private int CountIssues(FigmaPrefabBuildIssueSeverity severity)
        {
            int count = 0;
            for (int i = 0; i < Issues.Count; i++)
            {
                if (Issues[i] != null && Issues[i].Severity == severity)
                {
                    count++;
                }
            }

            return count;
        }
    }
}
