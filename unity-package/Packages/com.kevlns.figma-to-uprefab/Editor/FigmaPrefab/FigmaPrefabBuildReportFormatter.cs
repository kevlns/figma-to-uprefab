using System.Text;

namespace Kevlns.Editor.FigmaToUprefab
{
    public static class FigmaPrefabBuildReportFormatter
    {
        public static string FormatSummary(FigmaPrefabBuildReport report)
        {
            if (report == null)
            {
                return "[FigmaPrefab] Report is null.";
            }

            var builder = new StringBuilder();
            builder.AppendLine(report.HasErrors ? "[FigmaPrefab] Build failed." : "[FigmaPrefab] Build completed.");
            builder.AppendLine("Prefab: " + EmptyToDash(report.PrefabPath));
            builder.AppendLine("Base: " + EmptyToDash(report.BasePrefabPath));
            builder.AppendLine("Overwritten: " + report.Overwritten);
            builder.AppendLine("RCG: " + report.RcgCount);
            builder.AppendLine("References: " + report.ReferenceCount);
            builder.AppendLine("List/Grid: " + report.ListGridCount);
            builder.AppendLine("Missing References: " + report.MissingReferenceCount);
            builder.AppendLine("Fallback References: " + report.FallbackReferenceCount);
            builder.AppendLine("Staging Only: " + report.StagingOnly);
            builder.AppendLine("Promotion Prefab: " + EmptyToDash(report.SuggestedPromotionPrefabPath));
            builder.AppendLine("Promotion Sprite Folder: " + EmptyToDash(report.SuggestedPromotionSpriteFolder));

            builder.AppendLine("Warnings: " + report.WarningCount);
            builder.AppendLine("Errors: " + report.ErrorCount);

            if (report.ItemPrefabPaths.Count > 0)
            {
                builder.AppendLine("Item Prefabs:");
                for (int i = 0; i < report.ItemPrefabPaths.Count; i++)
                {
                    builder.AppendLine("- " + report.ItemPrefabPaths[i]);
                }
            }

            if (report.Issues.Count > 0)
            {
                builder.AppendLine("Issues:");
                for (int i = 0; i < report.Issues.Count; i++)
                {
                    var issue = report.Issues[i];
                    if (issue == null)
                    {
                        continue;
                    }

                    builder.Append("- ");
                    builder.Append(issue.Severity);
                    builder.Append(" ");
                    builder.Append(issue.Code);
                    if (!string.IsNullOrWhiteSpace(issue.Path))
                    {
                        builder.Append(" @ ");
                        builder.Append(issue.Path);
                    }

                    builder.Append(": ");
                    builder.AppendLine(issue.Message);
                }
            }

            return builder.ToString();
        }

        private static string EmptyToDash(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? "-" : value;
        }
    }
}
