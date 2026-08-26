using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

namespace Kevlns.Editor.FigmaToUprefab
{
    /// <summary>
    /// Parameterless batch entrypoint for the Node CLI (request/report protocol).
    ///
    /// Invoked as: Unity.exe -batchmode -projectPath <project> -executeMethod
    /// Kevlns.Editor.FigmaToUprefab.FigmaPrefabCliBatch.Run -quit
    ///
    /// Node writes <project>/Library/figma-to-uprefab/request.json, this method
    /// converts every root (source manifest + optional approximation overlay -> IR)
    /// and builds the staging prefabs, then writes report.json. Exit code is 0 on
    /// success and non-zero when any root failed or the legacy Vant-Framework copy
    /// is detected (fail-closed migration guard).
    /// </summary>
    public static class FigmaPrefabCliBatch
    {
        private const string MenuPath = "Tools/Figma To Uprefab/Run Batch From Request";

        [MenuItem(MenuPath)]
        public static void RunFromMenu()
        {
            Run();
        }

        public static void Run()
        {
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string workDir = Path.Combine(projectRoot, "Library", "figma-to-uprefab");
            string requestPath = Environment.GetEnvironmentVariable("FIGMA_TO_UPREFAB_REQUEST");
            if (string.IsNullOrWhiteSpace(requestPath))
            {
                requestPath = Path.Combine(workDir, "request.json");
            }

            var report = new FigmaPrefabCliReport();
            string exitIssueCode = null;
            string exitIssueMessage = null;
            try
            {
                if (!File.Exists(requestPath))
                {
                    exitIssueCode = "BLD_REQUEST_MISSING";
                    exitIssueMessage = $"Build request was not found: {requestPath}";
                }
                else
                {
                    var request = JsonConvert.DeserializeObject<FigmaPrefabCliRequest>(File.ReadAllText(requestPath));
                    if (request == null || request.SchemaVersion != 1)
                    {
                        exitIssueCode = "BLD_REQUEST_SCHEMA_UNSUPPORTED";
                        exitIssueMessage = "Build request schemaVersion must be 1.";
                    }
                    else if (!string.Equals(request.Mode, "convert-and-build", StringComparison.OrdinalIgnoreCase))
                    {
                        exitIssueCode = "BLD_REQUEST_MODE_UNSUPPORTED";
                        exitIssueMessage = $"Unsupported build request mode: {request.Mode}";
                    }
                    else
                    {
                        CheckLegacyLocation(out exitIssueCode, out exitIssueMessage);
                        if (exitIssueCode == null)
                        {
                            RunRoots(request, projectRoot, report);
                        }
                    }
                }
            }
            catch (Exception exception)
            {
                exitIssueCode = "BLD_UNEXPECTED";
                exitIssueMessage = exception.Message;
            }

            if (exitIssueCode != null)
            {
                report.Status = "error";
                report.Issues.Add(new FigmaPrefabCliIssue { Code = exitIssueCode, Message = exitIssueMessage });
                Debug.LogError($"[figma-to-uprefab] {exitIssueCode}: {exitIssueMessage}");
            }
            else if (report.HasErrors)
            {
                report.Status = "error";
            }
            else
            {
                report.Status = "ok";
            }

            Directory.CreateDirectory(workDir);
            string reportPath = Path.Combine(workDir, "report.json");
            File.WriteAllText(reportPath, JsonConvert.SerializeObject(report, Formatting.Indented));
            Debug.Log($"[figma-to-uprefab] wrote report: {reportPath}");

            int exitCode = report.Status == "ok" ? 0 : 1;
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(exitCode);
            }
        }

        private static void CheckLegacyLocation(out string code, out string message)
        {
            code = null;
            message = null;
            string legacyDir = Path.Combine(Application.dataPath, "Vant-Framework", "Editor", "FigmaPrefab");
            if (Directory.Exists(legacyDir))
            {
                code = "UNI_LEGACY_VANT_FIGMA_PREFAB";
                message = "The old Assets/Vant-Framework/Editor/FigmaPrefab copy still exists. Remove or migrate it before using @kevlns/figma-to-uprefab so the embedded converter is the single implementation.";
            }
        }

        private static void RunRoots(FigmaPrefabCliRequest request, string projectRoot, FigmaPrefabCliReport report)
        {
            string indexPath = ResolveProjectPath(projectRoot, request.RootIndexPath);
            if (!File.Exists(indexPath))
            {
                report.Issues.Add(new FigmaPrefabCliIssue { Code = "BLD_ROOT_INDEX_MISSING", Message = $"Root index does not exist: {indexPath}" });
                return;
            }

            var index = JsonConvert.DeserializeObject<FigmaPrefabRootBatchIndex>(File.ReadAllText(indexPath));
            if (index == null || index.Roots == null || index.Roots.Count == 0)
            {
                report.Issues.Add(new FigmaPrefabCliIssue { Code = "BLD_ROOT_INDEX_EMPTY", Message = "Root index has no discovered roots." });
                return;
            }

            string configPath = request.ConfigPath == null ? null : ResolveProjectPath(projectRoot, request.ConfigPath);
            for (int i = 0; i < index.Roots.Count; i++)
            {
                var entry = index.Roots[i];
                var entryReport = new FigmaPrefabCliEntryReport
                {
                    FigmaNodeId = entry.FigmaNodeId,
                    PrefabName = entry.PrefabName
                };
                report.Entries.Add(entryReport);

                if (entry == null || string.IsNullOrWhiteSpace(entry.SourceManifestPath) || string.IsNullOrWhiteSpace(entry.IrPath))
                {
                    entryReport.ErrorCode = "BLD_ENTRY_PATHS_MISSING";
                    entryReport.ErrorMessage = "Root index entry is missing sourceManifestPath or irPath.";
                    continue;
                }

                string manifestPath = ResolveProjectPath(projectRoot, entry.SourceManifestPath);
                string irPath = ResolveProjectPath(projectRoot, entry.IrPath);
                if (!File.Exists(manifestPath))
                {
                    entryReport.ErrorCode = "BLD_SOURCE_MANIFEST_MISSING";
                    entryReport.ErrorMessage = $"Source manifest does not exist: {entry.SourceManifestPath}";
                    continue;
                }

                string overlayPath = null;
                if (!string.IsNullOrWhiteSpace(request.OverlaySuffix))
                {
                    string overlayFile = entry.PrefabName + request.OverlaySuffix;
                    string overlayDir = Path.GetDirectoryName(irPath) ?? string.Empty;
                    string candidate = Path.Combine(overlayDir, overlayFile);
                    if (File.Exists(candidate))
                    {
                        overlayPath = candidate;
                    }
                }

                // Source manifest + optional overlay -> IR (the only converter).
                var conversion = FigmaPrefabSourceManifestAdapter.ConvertFromFile(manifestPath, configPath, overlayPath);
                if (conversion.HasErrors)
                {
                    entryReport.ErrorCode = "BLD_CONVERT_FAILED";
                    entryReport.ErrorMessage = SummarizeConversionIssues(conversion);
                    entryReport.Conversion = conversion;
                    continue;
                }

                string irError;
                if (!FigmaPrefabSourceManifestAdapter.TryWriteIr(conversion, irPath, out irError))
                {
                    entryReport.ErrorCode = "BLD_IR_WRITE_FAILED";
                    entryReport.ErrorMessage = irError;
                    entryReport.Conversion = conversion;
                    continue;
                }

                entryReport.Conversion = conversion;
                var build = FigmaPrefabBuilder.BuildFromIr(irPath);
                entryReport.Build = build;
                if (build != null && build.HasErrors)
                {
                    entryReport.ErrorCode = "BLD_BUILD_FAILED";
                    entryReport.ErrorMessage = SummarizeBuildIssues(build);
                }
            }
        }

        private static string ResolveProjectPath(string projectRoot, string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return path;
            }

            string normalized = path.Replace('\\', '/');
            if (Path.IsPathRooted(path))
            {
                return path;
            }

            return Path.Combine(projectRoot, normalized.Replace('/', Path.DirectorySeparatorChar));
        }

        private static string SummarizeConversionIssues(FigmaPrefabConversionResult conversion)
        {
            var parts = new List<string>();
            foreach (var issue in conversion.Issues)
            {
                parts.Add($"{issue.Code}: {issue.Message}");
            }

            return string.Join("; ", parts);
        }

        private static string SummarizeBuildIssues(FigmaPrefabBuildReport build)
        {
            var parts = new List<string>();
            foreach (var issue in build.Issues)
            {
                parts.Add($"{issue.Severity} {issue.Code}: {issue.Message}");
            }

            return string.Join("; ", parts);
        }
    }

    public sealed class FigmaPrefabCliRequest
    {
        [JsonProperty("schemaVersion")]
        public int SchemaVersion { get; set; }

        [JsonProperty("mode")]
        public string Mode { get; set; }

        [JsonProperty("rootIndexPath")]
        public string RootIndexPath { get; set; }

        [JsonProperty("configPath")]
        public string ConfigPath { get; set; }

        [JsonProperty("overlaySuffix")]
        public string OverlaySuffix { get; set; }
    }

    public sealed class FigmaPrefabCliReport
    {
        [JsonProperty("schemaVersion")]
        public int SchemaVersion { get; set; } = 1;

        [JsonProperty("status")]
        public string Status { get; set; }

        [JsonProperty("entries")]
        public List<FigmaPrefabCliEntryReport> Entries { get; set; } = new List<FigmaPrefabCliEntryReport>();

        [JsonProperty("issues")]
        public List<FigmaPrefabCliIssue> Issues { get; set; } = new List<FigmaPrefabCliIssue>();

        public bool HasErrors
        {
            get
            {
                for (int i = 0; i < Entries.Count; i++)
                {
                    if (Entries[i] != null && !string.IsNullOrWhiteSpace(Entries[i].ErrorCode))
                    {
                        return true;
                    }
                }

                return Issues.Count > 0;
            }
        }
    }

    public sealed class FigmaPrefabCliEntryReport
    {
        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("prefabName")]
        public string PrefabName { get; set; }

        [JsonProperty("errorCode")]
        public string ErrorCode { get; set; }

        [JsonProperty("errorMessage")]
        public string ErrorMessage { get; set; }

        [JsonProperty("conversion")]
        public object Conversion { get; set; }

        [JsonProperty("build")]
        public object Build { get; set; }
    }

    public sealed class FigmaPrefabCliIssue
    {
        [JsonProperty("code")]
        public string Code { get; set; }

        [JsonProperty("message")]
        public string Message { get; set; }
    }
}
