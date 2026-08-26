using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;

namespace Kevlns.Editor.FigmaToUprefab
{
    public sealed class FigmaPrefabRootBatchIndex
    {
        [JsonProperty("roots")]
        public List<FigmaPrefabRootBatchEntry> Roots { get; set; } = new List<FigmaPrefabRootBatchEntry>();
    }

    public sealed class FigmaPrefabRootBatchEntry
    {
        [JsonProperty("figmaNodeId")]
        public string FigmaNodeId { get; set; }

        [JsonProperty("prefabName")]
        public string PrefabName { get; set; }

        [JsonProperty("sourceManifestPath")]
        public string SourceManifestPath { get; set; }

        [JsonProperty("irPath")]
        public string IrPath { get; set; }
    }

    public sealed class FigmaPrefabRootBatchEntryReport
    {
        public string FigmaNodeId { get; set; }
        public string PrefabName { get; set; }
        public FigmaPrefabConversionResult Conversion { get; set; }
        public FigmaPrefabBuildReport Build { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }

        public bool HasErrors
        {
            get
            {
                return !string.IsNullOrWhiteSpace(ErrorCode) ||
                       (Conversion != null && Conversion.HasErrors) ||
                       (Build != null && Build.HasErrors);
            }
        }
    }

    public sealed class FigmaPrefabRootBatchReport
    {
        public List<FigmaPrefabRootBatchEntryReport> Entries { get; } = new List<FigmaPrefabRootBatchEntryReport>();

        public bool HasErrors
        {
            get
            {
                for (int i = 0; i < Entries.Count; i++)
                {
                    if (Entries[i] != null && Entries[i].HasErrors)
                    {
                        return true;
                    }
                }

                return false;
            }
        }
    }

    public static class FigmaPrefabRootBatch
    {
        public static FigmaPrefabRootBatchReport ConvertAllSourceManifestsToIr(string indexPath, string localConfigPath)
        {
            var report = new FigmaPrefabRootBatchReport();
            if (!TryReadIndex(indexPath, report, out FigmaPrefabRootBatchIndex index))
            {
                return report;
            }

            for (int i = 0; i < index.Roots.Count; i++)
            {
                FigmaPrefabRootBatchEntry entry = index.Roots[i];
                var entryReport = CreateEntryReport(entry);
                report.Entries.Add(entryReport);
                if (!TryValidateEntryPaths(entry, out string errorCode, out string errorMessage))
                {
                    entryReport.ErrorCode = errorCode;
                    entryReport.ErrorMessage = errorMessage;
                    continue;
                }

                entryReport.Conversion = FigmaToUprefabBuilder.ConvertSourceManifestToIr(
                    entry.SourceManifestPath,
                    entry.IrPath,
                    localConfigPath);
            }

            return report;
        }

        public static FigmaPrefabRootBatchReport BuildAllFromIr(string indexPath)
        {
            var report = new FigmaPrefabRootBatchReport();
            if (!TryReadIndex(indexPath, report, out FigmaPrefabRootBatchIndex index))
            {
                return report;
            }

            for (int i = 0; i < index.Roots.Count; i++)
            {
                FigmaPrefabRootBatchEntry entry = index.Roots[i];
                var entryReport = CreateEntryReport(entry);
                report.Entries.Add(entryReport);
                if (entry == null || string.IsNullOrWhiteSpace(entry.IrPath))
                {
                    entryReport.ErrorCode = "ROOT_INDEX_IR_PATH_MISSING";
                    entryReport.ErrorMessage = "A discovered root is missing its irPath.";
                    continue;
                }

                if (!File.Exists(entry.IrPath))
                {
                    entryReport.ErrorCode = "ROOT_INDEX_IR_MISSING";
                    entryReport.ErrorMessage = $"The generated IR does not exist: {entry.IrPath}";
                    continue;
                }

                entryReport.Build = FigmaToUprefabBuilder.BuildFromIr(entry.IrPath);
            }

            return report;
        }

        private static bool TryReadIndex(string indexPath, FigmaPrefabRootBatchReport report, out FigmaPrefabRootBatchIndex index)
        {
            index = null;
            if (string.IsNullOrWhiteSpace(indexPath) || !File.Exists(indexPath))
            {
                AddIndexError(report, "ROOT_INDEX_MISSING", $"Root batch index does not exist: {indexPath}");
                return false;
            }

            try
            {
                index = JsonConvert.DeserializeObject<FigmaPrefabRootBatchIndex>(File.ReadAllText(indexPath));
            }
            catch (Exception exception)
            {
                AddIndexError(report, "ROOT_INDEX_READ_FAILED", exception.Message);
                return false;
            }

            if (index == null || index.Roots == null || index.Roots.Count == 0)
            {
                AddIndexError(report, "ROOT_INDEX_EMPTY", "Root batch index has no discovered roots.");
                return false;
            }

            return true;
        }

        private static FigmaPrefabRootBatchEntryReport CreateEntryReport(FigmaPrefabRootBatchEntry entry)
        {
            return new FigmaPrefabRootBatchEntryReport
            {
                FigmaNodeId = entry?.FigmaNodeId,
                PrefabName = entry?.PrefabName
            };
        }

        private static bool TryValidateEntryPaths(FigmaPrefabRootBatchEntry entry, out string errorCode, out string errorMessage)
        {
            errorCode = null;
            errorMessage = null;
            if (entry == null)
            {
                errorCode = "ROOT_INDEX_ENTRY_NULL";
                errorMessage = "Root batch index contains a null entry.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(entry.SourceManifestPath))
            {
                errorCode = "ROOT_INDEX_SOURCE_PATH_MISSING";
                errorMessage = $"Root {entry.FigmaNodeId} is missing its sourceManifestPath.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(entry.IrPath))
            {
                errorCode = "ROOT_INDEX_IR_PATH_MISSING";
                errorMessage = $"Root {entry.FigmaNodeId} is missing its irPath.";
                return false;
            }

            if (!File.Exists(entry.SourceManifestPath))
            {
                errorCode = "ROOT_INDEX_SOURCE_MISSING";
                errorMessage = $"Root source manifest does not exist: {entry.SourceManifestPath}";
                return false;
            }

            return true;
        }

        private static void AddIndexError(FigmaPrefabRootBatchReport report, string code, string message)
        {
            report.Entries.Add(new FigmaPrefabRootBatchEntryReport
            {
                ErrorCode = code,
                ErrorMessage = message
            });
        }
    }
}
