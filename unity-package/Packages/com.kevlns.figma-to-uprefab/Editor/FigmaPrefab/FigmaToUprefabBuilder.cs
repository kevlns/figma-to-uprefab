namespace Kevlns.Editor.FigmaToUprefab
{
    public static class FigmaToUprefabBuilder
    {
        public static FigmaPrefabConversionResult ConvertSourceManifest(string manifestPath)
        {
            return FigmaPrefabSourceManifestAdapter.ConvertFromFile(manifestPath);
        }

        public static FigmaPrefabConversionResult ConvertSourceManifest(string manifestPath, string localConfigPath)
        {
            return FigmaPrefabSourceManifestAdapter.ConvertFromFile(manifestPath, localConfigPath);
        }

        public static FigmaPrefabConversionResult ConvertSourceManifestToIr(string manifestPath, string irPath)
        {
            return ConvertSourceManifestToIr(manifestPath, irPath, null);
        }

        public static FigmaPrefabConversionResult ConvertSourceManifestToIr(string manifestPath, string irPath, string localConfigPath)
        {
            var result = ConvertSourceManifest(manifestPath, localConfigPath);
            if (result.HasErrors)
            {
                return result;
            }

            if (!FigmaPrefabSourceManifestAdapter.TryWriteIr(result, irPath, out var error))
            {
                result.Issues.Add(new FigmaPrefabConversionIssue
                {
                    IsError = true,
                    Code = "SOURCE_IR_WRITE_FAILED",
                    Message = error
                });
            }

            return result;
        }

        public static FigmaPrefabRootBatchReport ConvertAllSourceManifestsToIr(string rootIndexPath, string localConfigPath)
        {
            return FigmaPrefabRootBatch.ConvertAllSourceManifestsToIr(rootIndexPath, localConfigPath);
        }

        public static FigmaPrefabRootBatchReport BuildAllRootsFromIr(string rootIndexPath)
        {
            return FigmaPrefabRootBatch.BuildAllFromIr(rootIndexPath);
        }

        public static FigmaPrefabBuildReport BuildFromIr(string irPath)
        {
            return FigmaPrefabBuilder.BuildFromIr(irPath);
        }

        public static FigmaPrefabBuildReport BuildFromIr(string irPath, FigmaPrefabBuildOptions options)
        {
            return FigmaPrefabBuilder.BuildFromIr(irPath, options);
        }

        public static FigmaPrefabBuildReport BuildFromIr(FigmaPrefabIr ir, FigmaPrefabBuildOptions options = null)
        {
            return FigmaPrefabBuilder.Build(ir, options);
        }
    }
}
