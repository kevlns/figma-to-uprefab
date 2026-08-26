using System.IO;
using UnityEditor;
using UnityEngine;

namespace Kevlns.Editor.FigmaToUprefab
{
    public static class FigmaPrefabBuilderMenu
    {
        private const string MenuPath = "Tools/Figma To Uprefab/Build From IR";

        [MenuItem(MenuPath)]
        public static void BuildFromIr()
        {
            string selectedPath = EditorUtility.OpenFilePanel("Build Figma Prefab From IR", Application.dataPath, "json");
            if (string.IsNullOrWhiteSpace(selectedPath))
            {
                return;
            }

            string irPath = ToProjectRelativePath(selectedPath);
            var report = FigmaToUprefabBuilder.BuildFromIr(irPath);
            string summary = FigmaPrefabBuildReportFormatter.FormatSummary(report);

            if (report.HasErrors)
            {
                Debug.LogError(summary);
                EditorUtility.DisplayDialog("Figma Prefab Build Failed", BuildDialogMessage(report), "OK");
            }
            else
            {
                Debug.Log(summary);
                EditorUtility.DisplayDialog("Figma Prefab Build Completed", BuildDialogMessage(report), "OK");
            }
        }

        private static string ToProjectRelativePath(string absolutePath)
        {
            string normalized = absolutePath.Replace('\\', '/');
            string projectRoot = Directory.GetParent(Application.dataPath).FullName.Replace('\\', '/');
            if (normalized.StartsWith(projectRoot + "/", global::System.StringComparison.Ordinal))
            {
                return normalized.Substring(projectRoot.Length + 1);
            }

            return normalized;
        }

        private static string BuildDialogMessage(FigmaPrefabBuildReport report)
        {
            if (report == null)
            {
                return "Report is null.";
            }

            return "Prefab: " + (string.IsNullOrWhiteSpace(report.PrefabPath) ? "-" : report.PrefabPath) +
                   "\nErrors: " + report.ErrorCount +
                   "\nWarnings: " + report.WarningCount +
                   "\nSee Console for details.";
        }
    }
}
